'use client';

import { useCallback, useEffect, useRef } from 'react';
import { EncryptionKeyManager } from '@/src/lib/encryption/EncryptionKeyManager';
import { EncryptionPipeline } from '@/src/lib/encryption/EncryptionPipeline';
import type { EncryptedPayload, KeyDerivationOptions, KeyPurpose, KeyAlgorithm, EncryptionKey } from '@/src/lib/encryption/types';
import { useEncryptionStore } from '@/src/store/encryptionStore';

export interface UseEncryptionKeyManagerReturn {
  status: ReturnType<typeof useEncryptionStore.getState>['status'];
  activeKeyId: string | null;
  isReady: boolean;
  activeKey: EncryptionKey | null;
  allActiveKeys: EncryptionKey[];
  error: string | null;
  lastRotation: ReturnType<typeof useEncryptionStore.getState>['lastRotation'];
  initialize: (opts: KeyDerivationOptions) => Promise<boolean>;
  encrypt: (plaintext: string, keyId?: string) => Promise<EncryptedPayload | null>;
  decrypt: (payload: EncryptedPayload) => Promise<string | null>;
  rotateActiveKey: () => Promise<boolean>;
  generateKey: (purpose?: KeyPurpose, algorithm?: KeyAlgorithm, label?: string) => Promise<boolean>;
  revokeKey: (keyId: string) => void;
  reset: () => void;
}

export function useEncryptionKeyManager(): UseEncryptionKeyManagerReturn {
  const store = useEncryptionStore();
  const isReady = store.status === 'ready' && store.activeKeyId !== null;
  const activeKey = store.keys.find((key) => key.id === store.activeKeyId) ?? null;
  const allActiveKeys = store.keys.filter((key) => key.status === 'active');

  const managerRef = useRef<EncryptionKeyManager | null>(null);
  const pipelineRef = useRef<EncryptionPipeline | null>(null);

  const clearPersistedStorage = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const storage = window.localStorage;
      const keysToRemove: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith('sorotask_enc_keys')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => storage.removeItem(key));
    } catch {
      // Best-effort cleanup.
    }
  }, []);

  const getOrCreateManager = useCallback(() => {
    if (!managerRef.current) {
      managerRef.current = new EncryptionKeyManager();
      pipelineRef.current = new EncryptionPipeline({ manager: managerRef.current });
    }
    return { manager: managerRef.current, pipeline: pipelineRef.current! };
  }, []);

  // Sync persisted key metadata into the store on mount
  useEffect(() => {
    const { manager } = getOrCreateManager();
    const persistedKeys = manager.listKeys();
    if (persistedKeys.length > 0) {
      store.setKeys(persistedKeys);
      const active = manager.getActiveKeyId();
      if (active) {
        store.setActiveKeyId(active);
        store.setStatus('ready');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialize = useCallback(async (opts: KeyDerivationOptions): Promise<boolean> => {
    const { pipeline } = getOrCreateManager();
    store.setStatus('initializing');

    const result = await pipeline.bootstrap(opts);
    if (!result.success || !result.data) {
      store.setError(result.error ?? 'Initialization failed');
      return false;
    }

    const { manager } = getOrCreateManager();
    store.setKeys(manager.listKeys());
    store.setActiveKeyId(result.data);
    store.setStatus('ready');
    return true;
  }, [getOrCreateManager, store]);

  const encrypt = useCallback(async (plaintext: string, keyId?: string): Promise<EncryptedPayload | null> => {
    const { pipeline } = getOrCreateManager();
    const result = await pipeline.safeEncrypt(plaintext, keyId);
    if (!result.success || !result.data) {
      store.setError(result.error ?? 'Encryption failed');
      return null;
    }
    store.setLastEncrypted(result.data);
    return result.data;
  }, [getOrCreateManager, store]);

  const decrypt = useCallback(async (payload: EncryptedPayload): Promise<string | null> => {
    const { pipeline } = getOrCreateManager();
    const result = await pipeline.safeDecrypt(payload);
    if (!result.success || result.data === undefined) {
      store.setError(result.error ?? 'Decryption failed');
      return null;
    }
    return result.data;
  }, [getOrCreateManager, store]);

  const rotateActiveKey = useCallback(async (): Promise<boolean> => {
    const currentId = store.activeKeyId;
    if (!currentId) {
      store.setError('No active key to rotate');
      return false;
    }

    const { pipeline, manager } = getOrCreateManager();
    store.setStatus('rotating');

    const result = await pipeline.safeRotateKey(currentId);
    if (!result.success || !result.data) {
      store.setError(result.error ?? 'Rotation failed');
      return false;
    }

    store.updateKey(result.data.oldKeyId, { status: 'rotated', rotatedAt: result.data.rotatedAt });
    const newMeta = manager.getKeyMetadata(result.data.newKeyId);
    if (newMeta) store.addKey(newMeta);
    store.setActiveKeyId(result.data.newKeyId);
    store.setLastRotation(result.data);
    store.setStatus('ready');
    return true;
  }, [getOrCreateManager, store]);

  const generateKey = useCallback(async (
    purpose: KeyPurpose = 'encrypt',
    algorithm: KeyAlgorithm = 'AES-GCM',
    label?: string,
  ): Promise<boolean> => {
    try {
      const { manager } = getOrCreateManager();
      const meta = await manager.generateKey(purpose, algorithm, label);
      store.addKey(meta);
      if (!store.activeKeyId) {
        store.setActiveKeyId(meta.id);
        store.setStatus('ready');
      }
      return true;
    } catch (err) {
      store.setError(err instanceof Error ? err.message : 'Key generation failed');
      return false;
    }
  }, [getOrCreateManager, store]);

  const revokeKey = useCallback((keyId: string): void => {
    const { manager } = getOrCreateManager();
    manager.revokeKey(keyId);
    store.updateKey(keyId, { status: 'revoked' });
    const newActiveId = manager.getActiveKeyId();
    store.setActiveKeyId(newActiveId);
    if (!newActiveId) store.setStatus('idle');
  }, [getOrCreateManager, store]);

  const reset = useCallback((): void => {
    clearPersistedStorage();

    try {
      const resetManager = new EncryptionKeyManager();
      resetManager.clearStorage();
    } catch {
      // Ignore storage reset errors and fall back to the active instance if present.
    }

    if (managerRef.current) {
      managerRef.current.clearStorage();
    }
    managerRef.current = null;
    pipelineRef.current = null;
    store.reset();
  }, [clearPersistedStorage, store]);

  return {
    status: store.status,
    activeKeyId: store.activeKeyId,
    isReady,
    activeKey,
    allActiveKeys,
    error: store.error,
    lastRotation: store.lastRotation,
    initialize,
    encrypt,
    decrypt,
    rotateActiveKey,
    generateKey,
    revokeKey,
    reset,
  };
}
