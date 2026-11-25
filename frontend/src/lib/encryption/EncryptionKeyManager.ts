import {
  EncryptionKey,
  WrappedKeyRecord,
  EncryptedPayload,
  KeyDerivationOptions,
  RotationResult,
  KeyManagerOptions,
  KeyManagerState,
  KeyAlgorithm,
  KeyPurpose,
  EncryptionError,
} from './types';

const STORAGE_KEY_DEFAULT = 'sorotask_enc_keys';
const PBKDF2_ITERATIONS_DEFAULT = 200_000;
const AES_KEY_LENGTH = 256;

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getTextEncoder(): TextEncoder {
  if (typeof globalThis.TextEncoder !== 'undefined') {
    return new globalThis.TextEncoder();
  }
  // Fallback for environments where TextEncoder is not available globally.
  return new (require('util').TextEncoder)() as TextEncoder;
}

function getTextDecoder(): TextDecoder {
  if (typeof globalThis.TextDecoder !== 'undefined') {
    return new globalThis.TextDecoder();
  }
  return new (require('util').TextDecoder)() as TextDecoder;
}

function getSubtleCrypto(): SubtleCrypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { webcrypto } = require('crypto');
  return webcrypto.subtle as SubtleCrypto;
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

export class EncryptionKeyManager {
  private state: KeyManagerState = {
    keys: new Map(),
    metadata: new Map(),
    activeKeyId: null,
  };

  private readonly storageKey: string;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  private readonly subtle: SubtleCrypto;

  constructor(options: KeyManagerOptions = {}) {
    this.storageKey = options.storageKey ?? STORAGE_KEY_DEFAULT;
    this.storage = options.storage === undefined ? this.getDefaultStorage() : options.storage;
    this.subtle = options.crypto ?? getSubtleCrypto();
    this.loadMetadata();
  }

  // ── Key generation ────────────────────────────────────────────────────────

  async generateKey(
    purpose: KeyPurpose = 'encrypt',
    algorithm: KeyAlgorithm = 'AES-GCM',
    label?: string,
  ): Promise<EncryptionKey> {
    try {
      const cryptoKey = await this.subtle.generateKey(
        { name: algorithm, length: AES_KEY_LENGTH },
        true,
        purpose === 'wrap' ? ['wrapKey', 'unwrapKey'] : ['encrypt', 'decrypt'],
      );

      const id = generateId();
      const meta: EncryptionKey = {
        id,
        algorithm,
        purpose,
        status: 'active',
        createdAt: Date.now(),
        label,
      };

      this.state.keys.set(id, cryptoKey);
      this.state.metadata.set(id, meta);
      if (!this.state.activeKeyId) this.state.activeKeyId = id;

      this.persistMetadata();
      return meta;
    } catch (err) {
      throw new EncryptionError('Key generation failed', 'KEY_GEN_FAILED', err);
    }
  }

  // ── Key derivation ────────────────────────────────────────────────────────

  async deriveKey(opts: KeyDerivationOptions): Promise<EncryptionKey> {
    try {
      const { password, iterations = PBKDF2_ITERATIONS_DEFAULT, hash = 'SHA-256' } = opts;
      const salt = opts.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));

      const rawPasswordKey = await this.subtle.importKey(
        'raw',
        getTextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey'],
      );

      const cryptoKey = await this.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash },
        rawPasswordKey,
        { name: 'AES-GCM', length: AES_KEY_LENGTH },
        true,
        ['wrapKey', 'unwrapKey'],
      );

      const id = generateId();
      const meta: EncryptionKey = {
        id,
        algorithm: 'AES-GCM',
        purpose: 'wrap',
        status: 'active',
        createdAt: Date.now(),
        label: 'password-derived',
      };

      this.state.keys.set(id, cryptoKey);
      this.state.metadata.set(id, meta);
      if (!this.state.activeKeyId) this.state.activeKeyId = id;

      this.persistMetadata();
      return meta;
    } catch (err) {
      throw new EncryptionError('Key derivation failed', 'KEY_DERIVE_FAILED', err);
    }
  }

  // ── Encrypt / Decrypt ─────────────────────────────────────────────────────

  async encrypt(plaintext: string, keyId?: string): Promise<EncryptedPayload> {
    const resolvedKeyId = keyId ?? this.state.activeKeyId;
    if (!resolvedKeyId) {
      throw new EncryptionError('No active key available for encryption', 'NO_ACTIVE_KEY');
    }

    const cryptoKey = this.state.keys.get(resolvedKeyId);
    if (!cryptoKey) {
      throw new EncryptionError(`Key not found: ${resolvedKeyId}`, 'KEY_NOT_FOUND');
    }

    const meta = this.state.metadata.get(resolvedKeyId);
    if (!meta) {
      throw new EncryptionError(`Key metadata not found: ${resolvedKeyId}`, 'KEY_META_NOT_FOUND');
    }

    try {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const encoded = getTextEncoder().encode(plaintext);

      const cipherBuffer = await this.subtle.encrypt(
        { name: meta.algorithm, iv: iv as BufferSource },
        cryptoKey,
        encoded as BufferSource,
      );

      return {
        ciphertext: toBase64(cipherBuffer),
        iv: toBase64(iv.buffer),
        keyId: resolvedKeyId,
        algorithm: meta.algorithm,
      };
    } catch (err) {
      throw new EncryptionError('Encryption failed', 'ENCRYPT_FAILED', err);
    }
  }

  async decrypt(payload: EncryptedPayload): Promise<string> {
    const cryptoKey = this.state.keys.get(payload.keyId);
    if (!cryptoKey) {
      throw new EncryptionError(`Key not found for decryption: ${payload.keyId}`, 'KEY_NOT_FOUND');
    }

    try {
      const iv = fromBase64(payload.iv);
      const ciphertext = fromBase64(payload.ciphertext);

      const plainBuffer = await this.subtle.decrypt(
        { name: payload.algorithm, iv: iv as BufferSource },
        cryptoKey,
        ciphertext as BufferSource,
      );

      return getTextDecoder().decode(plainBuffer);
    } catch (err) {
      throw new EncryptionError('Decryption failed', 'DECRYPT_FAILED', err);
    }
  }

  // ── Key wrapping / persistence ────────────────────────────────────────────

  async wrapKey(keyId: string, wrappingKeyId: string): Promise<WrappedKeyRecord> {
    const keyToWrap = this.state.keys.get(keyId);
    const wrappingKey = this.state.keys.get(wrappingKeyId);
    const meta = this.state.metadata.get(keyId);

    if (!keyToWrap) throw new EncryptionError(`Key to wrap not found: ${keyId}`, 'KEY_NOT_FOUND');
    if (!wrappingKey) throw new EncryptionError(`Wrapping key not found: ${wrappingKeyId}`, 'WRAP_KEY_NOT_FOUND');
    if (!meta) throw new EncryptionError(`Key metadata not found: ${keyId}`, 'KEY_META_NOT_FOUND');

    try {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const wrappedBuffer = await this.subtle.wrapKey('raw', keyToWrap, wrappingKey, {
        name: 'AES-GCM',
        iv: iv as BufferSource,
      });

      const record: WrappedKeyRecord = {
        keyId,
        wrappedKey: toBase64(wrappedBuffer),
        iv: toBase64(iv.buffer),
        algorithm: meta.algorithm,
        purpose: meta.purpose,
        createdAt: meta.createdAt,
        label: meta.label,
      };

      this.saveWrappedKey(record);
      return record;
    } catch (err) {
      throw new EncryptionError('Key wrapping failed', 'WRAP_FAILED', err);
    }
  }

  async unwrapKey(record: WrappedKeyRecord, wrappingKeyId: string): Promise<EncryptionKey> {
    const wrappingKey = this.state.keys.get(wrappingKeyId);
    if (!wrappingKey) {
      throw new EncryptionError(`Wrapping key not found: ${wrappingKeyId}`, 'WRAP_KEY_NOT_FOUND');
    }

    try {
      const iv = fromBase64(record.iv);
      const wrappedKey = fromBase64(record.wrappedKey);

      const usages: KeyUsage[] = record.purpose === 'wrap'
        ? ['wrapKey', 'unwrapKey']
        : ['encrypt', 'decrypt'];

      const cryptoKey = await this.subtle.unwrapKey(
        'raw',
        wrappedKey as BufferSource,
        wrappingKey,
        { name: 'AES-GCM', iv: iv as BufferSource },
        { name: record.algorithm, length: AES_KEY_LENGTH },
        true,
        usages,
      );

      const meta: EncryptionKey = {
        id: record.keyId,
        algorithm: record.algorithm,
        purpose: record.purpose,
        status: 'active',
        createdAt: record.createdAt,
        label: record.label,
      };

      this.state.keys.set(record.keyId, cryptoKey);
      this.state.metadata.set(record.keyId, meta);

      this.persistMetadata();
      return meta;
    } catch (err) {
      throw new EncryptionError('Key unwrapping failed', 'UNWRAP_FAILED', err);
    }
  }

  // ── Key rotation ──────────────────────────────────────────────────────────

  async rotateKey(oldKeyId: string): Promise<RotationResult> {
    const oldMeta = this.state.metadata.get(oldKeyId);
    if (!oldMeta) {
      throw new EncryptionError(`Key to rotate not found: ${oldKeyId}`, 'KEY_NOT_FOUND');
    }

    const newMeta = await this.generateKey(oldMeta.purpose, oldMeta.algorithm, oldMeta.label);

    // Mark old key as rotated
    this.state.metadata.set(oldKeyId, {
      ...oldMeta,
      status: 'rotated',
      rotatedAt: Date.now(),
    });

    if (this.state.activeKeyId === oldKeyId) {
      this.state.activeKeyId = newMeta.id;
    }

    this.persistMetadata();

    return {
      oldKeyId,
      newKeyId: newMeta.id,
      rotatedAt: Date.now(),
    };
  }

  revokeKey(keyId: string): void {
    const meta = this.state.metadata.get(keyId);
    if (!meta) return;

    this.state.metadata.set(keyId, { ...meta, status: 'revoked' });
    this.state.keys.delete(keyId);

    if (this.state.activeKeyId === keyId) {
      this.state.activeKeyId = this.findNextActiveKeyId();
    }

    this.persistMetadata();
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  getActiveKeyId(): string | null {
    return this.state.activeKeyId;
  }

  setActiveKeyId(keyId: string): void {
    if (!this.state.metadata.has(keyId)) {
      throw new EncryptionError(`Key not found: ${keyId}`, 'KEY_NOT_FOUND');
    }
    this.state.activeKeyId = keyId;
  }

  getKeyMetadata(keyId: string): EncryptionKey | undefined {
    return this.state.metadata.get(keyId);
  }

  listKeys(): EncryptionKey[] {
    return Array.from(this.state.metadata.values());
  }

  hasKey(keyId: string): boolean {
    return this.state.keys.has(keyId);
  }

  // ── Export / Import (raw bytes) ───────────────────────────────────────────

  async exportKey(keyId: string): Promise<ArrayBuffer> {
    const cryptoKey = this.state.keys.get(keyId);
    if (!cryptoKey) {
      throw new EncryptionError(`Key not found: ${keyId}`, 'KEY_NOT_FOUND');
    }
    try {
      return this.subtle.exportKey('raw', cryptoKey);
    } catch (err) {
      throw new EncryptionError('Key export failed', 'EXPORT_FAILED', err);
    }
  }

  async importKey(
    rawKey: ArrayBuffer,
    purpose: KeyPurpose = 'encrypt',
    algorithm: KeyAlgorithm = 'AES-GCM',
    label?: string,
  ): Promise<EncryptionKey> {
    try {
      const usages: KeyUsage[] = purpose === 'wrap'
        ? ['wrapKey', 'unwrapKey']
        : ['encrypt', 'decrypt'];

      const cryptoKey = await this.subtle.importKey(
        'raw',
        rawKey,
        { name: algorithm, length: AES_KEY_LENGTH },
        true,
        usages,
      );

      const id = generateId();
      const meta: EncryptionKey = {
        id,
        algorithm,
        purpose,
        status: 'active',
        createdAt: Date.now(),
        label,
      };

      this.state.keys.set(id, cryptoKey);
      this.state.metadata.set(id, meta);
      if (!this.state.activeKeyId) this.state.activeKeyId = id;

      this.persistMetadata();
      return meta;
    } catch (err) {
      throw new EncryptionError('Key import failed', 'IMPORT_FAILED', err);
    }
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  private getDefaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private persistMetadata(): void {
    if (!this.storage) return;
    try {
      const serialized = JSON.stringify({
        metadata: Array.from(this.state.metadata.entries()),
        activeKeyId: this.state.activeKeyId,
      });
      this.storage.setItem(this.storageKey, serialized);
    } catch {
      // Storage quota — best-effort persistence
    }
  }

  private loadMetadata(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.metadata)) {
        for (const [id, meta] of parsed.metadata) {
          this.state.metadata.set(id, meta as EncryptionKey);
        }
      }
      if (parsed.activeKeyId) {
        this.state.activeKeyId = parsed.activeKeyId;
      }
    } catch {
      // Corrupted storage — start fresh
    }
  }

  private saveWrappedKey(record: WrappedKeyRecord): void {
    if (!this.storage) return;
    try {
      const storageKey = `${this.storageKey}_wrapped_${record.keyId}`;
      this.storage.setItem(storageKey, JSON.stringify(record));
    } catch {
      // best-effort
    }
  }

  getWrappedKey(keyId: string): WrappedKeyRecord | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(`${this.storageKey}_wrapped_${keyId}`);
      return raw ? (JSON.parse(raw) as WrappedKeyRecord) : null;
    } catch {
      return null;
    }
  }

  clearStorage(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.storageKey);
      for (const keyId of this.state.metadata.keys()) {
        this.storage.removeItem(`${this.storageKey}_wrapped_${keyId}`);
      }
    } catch {
      // best-effort
    }
    this.state = { keys: new Map(), metadata: new Map(), activeKeyId: null };
  }

  private findNextActiveKeyId(): string | null {
    for (const [id, meta] of this.state.metadata) {
      if (meta.status === 'active' && this.state.keys.has(id)) return id;
    }
    return null;
  }
}
