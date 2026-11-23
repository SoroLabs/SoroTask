'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EncryptionKeyManager } from '@/src/lib/encryption/EncryptionKeyManager';
import { EncryptionPipeline } from '@/src/lib/encryption/EncryptionPipeline';
import {
  decryptTaskArguments as decryptTaskArgumentsWith,
  decryptWebhookConfig as decryptWebhookConfigWith,
  encryptTaskArguments as encryptTaskArgumentsWith,
  encryptWebhookConfig as encryptWebhookConfigWith,
  type EncryptedTaskArguments,
  type EncryptedWebhookConfig,
  type WebhookConfig,
} from '@/src/lib/encryption/payloadEncryption';
import type {
  EncryptedEnvelope,
  EncryptedPayload,
  KeyDerivationOptions,
  KeyPurpose,
  KeyAlgorithm,
  EncryptionKey,
} from '@/src/lib/encryption/types';
import { useEncryptionStore } from '@/src/store/encryptionStore';

export interface UseEncryptionKeyManagerReturn {
  status: ReturnType<typeof useEncryptionStore.getState>['status'];
  activeKeyId: string | null;
  isReady: boolean;
  /** Keys exist on this device but the master key is not in memory. */
  isLocked: boolean;
  /** True while any encrypt/decrypt/derive operation started by this hook is running. */
  isProcessing: boolean;
  activeKey: EncryptionKey | null;
  allActiveKeys: EncryptionKey[];
  /** Lifecycle error (store) or the last payload-operation error, whichever is set. */
  error: string | null;
  lastRotation: ReturnType<typeof useEncryptionStore.getState>['lastRotation'];
  initialize: (opts: KeyDerivationOptions) => Promise<boolean>;
  /** Alias of `initialize`; re-derives existing keys on a returning device. */
  unlock: (opts: KeyDerivationOptions) => Promise<boolean>;
  /** Wipe all in-memory key material (metadata is kept). */
  lock: () => void;
  encrypt: (plaintext: string, keyId?: string) => Promise<EncryptedPayload | null>;
  decrypt: (payload: EncryptedPayload) => Promise<string | null>;
  encryptField: (plaintext: string, context: string) => Promise<EncryptedEnvelope | null>;
  decryptField: (envelope: EncryptedEnvelope, context: string) => Promise<string | null>;
  encryptTaskArguments: (taskId: string, args: unknown) => Promise<EncryptedTaskArguments | null>;
  decryptTaskArguments: <T = unknown>(payload: EncryptedTaskArguments) => Promise<T | null>;
  encryptWebhookConfig: (taskId: string, config: WebhookConfig) => Promise<EncryptedWebhookConfig | null>;
  decryptWebhookConfig: (payload: EncryptedWebhookConfig) => Promise<WebhookConfig | null>;
  rotateActiveKey: () => Promise<boolean>;
  generateKey: (purpose?: KeyPurpose, algorithm?: KeyAlgorithm, label?: string) => Promise<boolean>;
  revokeKey: (keyId: string) => void;
  reset: () => void;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function useEncryptionKeyManager(): UseEncryptionKeyManagerReturn {
  const store = useEncryptionStore();
  const isReady = store.status === 'ready' && store.activeKeyId !== null;
  const isLocked = store.status === 'locked';
  const activeKey = store.keys.find((key) => key.id === store.activeKeyId) ?? null;
  const allActiveKeys = store.keys.filter((key) => key.status === 'active');

  const managerRef = useRef<EncryptionKeyManager | null>(null);
  const pipelineRef = useRef<EncryptionPipeline | null>(null);
  const inFlightRef = useRef(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

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

  /** Track a payload operation: loading flag + local (non-lifecycle) error. */
  const track = useCallback(async <T,>(fallback: string, op: () => Promise<T>): Promise<T | null> => {
    inFlightRef.current += 1;
    setIsProcessing(true);
    setOperationError(null);
    try {
      return await op();
    } catch (err) {
      setOperationError(messageOf(err, fallback));
      return null;
    } finally {
      inFlightRef.current -= 1;
      if (inFlightRef.current === 0) setIsProcessing(false);
    }
  }, []);

  // Sync persisted key metadata into the store on mount. Key material is never
  // persisted, so a returning device starts `locked` until the creator unlocks.
  useEffect(() => {
    const { manager } = getOrCreateManager();
    const persistedKeys = manager.listKeys();
    if (persistedKeys.length > 0) {
      store.setKeys(persistedKeys);
      const active = manager.getActiveKeyId();
      if (active) {
        store.setActiveKeyId(active);
        if (useEncryptionStore.getState().status === 'idle') {
          store.setStatus(manager.isUnlocked() || manager.hasKey(active) ? 'ready' : 'locked');
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialize = useCallback(async (opts: KeyDerivationOptions): Promise<boolean> => {
    const { pipeline, manager } = getOrCreateManager();
    store.setStatus('initializing');
    inFlightRef.current += 1;
    setIsProcessing(true);
    try {
      const result = await pipeline.bootstrap(opts);
      if (!result.success || !result.data) {
        store.setError(result.error ?? 'Initialization failed');
        return false;
      }
      store.setKeys(manager.listKeys());
      store.setActiveKeyId(result.data);
      store.setStatus('ready');
      setOperationError(null);
      return true;
    } finally {
      inFlightRef.current -= 1;
      if (inFlightRef.current === 0) setIsProcessing(false);
    }
  }, [getOrCreateManager, store]);

  const lock = useCallback((): void => {
    managerRef.current?.lock();
    setOperationError(null);
    store.setStatus(store.keys.length > 0 ? 'locked' : 'idle');
  }, [store]);

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

  const encryptField = useCallback(
    (plaintext: string, context: string) =>
      track('Encryption failed', () => getOrCreateManager().manager.encryptEnvelope(plaintext, context)),
    [getOrCreateManager, track],
  );

  const decryptField = useCallback(
    (envelope: EncryptedEnvelope, context: string) =>
      track('Decryption failed', () => getOrCreateManager().manager.decryptEnvelope(envelope, context)),
    [getOrCreateManager, track],
  );

  const encryptTaskArguments = useCallback(
    (taskId: string, args: unknown) =>
      track('Failed to encrypt task arguments', () =>
        encryptTaskArgumentsWith(getOrCreateManager().manager, taskId, args)),
    [getOrCreateManager, track],
  );

  const decryptTaskArguments = useCallback(
    <T = unknown,>(payload: EncryptedTaskArguments) =>
      track('Failed to decrypt task arguments', () =>
        decryptTaskArgumentsWith<T>(getOrCreateManager().manager, payload)),
    [getOrCreateManager, track],
  );

  const encryptWebhookConfig = useCallback(
    (taskId: string, config: WebhookConfig) =>
      track('Failed to encrypt webhook', () =>
        encryptWebhookConfigWith(getOrCreateManager().manager, taskId, config)),
    [getOrCreateManager, track],
  );

  const decryptWebhookConfig = useCallback(
    (payload: EncryptedWebhookConfig) =>
      track('Failed to decrypt webhook', () =>
        decryptWebhookConfigWith(getOrCreateManager().manager, payload)),
    [getOrCreateManager, track],
  );

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
    store.setActiveKeyId(manager.getActiveKeyId() ?? result.data.newKeyId);
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
      // Prefer a re-derivable key when the master key is unlocked.
      const meta = manager.isUnlocked() && algorithm === 'AES-GCM'
        ? await manager.deriveDataKey(label, purpose)
        : await manager.generateKey(purpose, algorithm, label);
      store.addKey(meta);
      if (!store.activeKeyId) {
        store.setActiveKeyId(meta.id);
        store.setStatus('ready');
      }
      return true;
    } catch (err) {
      store.setError(messageOf(err, 'Key generation failed'));
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
    setOperationError(null);
    store.reset();
  }, [clearPersistedStorage, store]);

  return {
    status: store.status,
    activeKeyId: store.activeKeyId,
    isReady,
    isLocked,
    isProcessing,
    activeKey,
    allActiveKeys,
    error: store.error ?? operationError,
    lastRotation: store.lastRotation,
    initialize,
    unlock: initialize,
    lock,
    encrypt,
    decrypt,
    encryptField,
    decryptField,
    encryptTaskArguments,
    decryptTaskArguments,
    encryptWebhookConfig,
    decryptWebhookConfig,
    rotateActiveKey,
    generateKey,
    revokeKey,
    reset,
  };
}
