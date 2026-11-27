import {
  EncryptionKey,
  WrappedKeyRecord,
  EncryptedPayload,
  EncryptedEnvelope,
  EncryptOptions,
  KeyDerivationOptions,
  KeyDerivationRecord,
  RotationResult,
  KeyManagerOptions,
  KeyManagerState,
  KeyAlgorithm,
  KeyPurpose,
  UnlockResult,
  EncryptionError,
  ENVELOPE_ALG,
  ENVELOPE_VERSION,
} from './types';

/**
 * Client-side end-to-end encryption key manager.
 *
 * Security model
 * --------------
 * - All key material lives in `CryptoKey` objects created with
 *   `extractable: false` unless a caller explicitly opts in (only needed for
 *   `wrapKey`/`exportKey`). Raw key bytes are never serialized, persisted,
 *   sent over the network, or logged.
 * - The creator's passphrase is stretched with PBKDF2-SHA-256 (600k iterations
 *   by default) using a salt derived from the creator identity (or a random,
 *   persisted salt). The result becomes an HKDF master key.
 * - Data keys are derived from the master key with HKDF-SHA-256 using a random
 *   per-key salt and a domain-separated `info` that includes the key id. Only
 *   the (public) salt/info are persisted, so rotated keys can be re-derived
 *   for decryption after a reload without ever storing key bytes.
 * - Every message uses a fresh random 96-bit IV. Envelopes bind the version,
 *   algorithm, key id and a caller-supplied context (task id + field) as AES-GCM
 *   additional authenticated data, so ciphertexts cannot be swapped between
 *   tasks/fields or re-labelled with another key id.
 * - `lock()` drops every in-memory key reference (master + data keys) and
 *   zeroes transient byte buffers.
 */

const STORAGE_KEY_DEFAULT = 'sorotask_enc_keys';
const PBKDF2_ITERATIONS_DEFAULT = 600_000;
const PBKDF2_ITERATIONS_MIN = 1_000;
const AES_KEY_LENGTH = 256;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const SALT_BYTES = 16;
const MAX_MESSAGES_PER_KEY_DEFAULT = 2 ** 31;

const DOMAIN = 'sorotask:e2e:v1';
const VERIFIER_PLAINTEXT = `${DOMAIN}:verifier`;

interface MasterConfig {
  v: 1;
  kdf: 'PBKDF2';
  hash: 'SHA-256' | 'SHA-512';
  iterations: number;
  /** base64 PBKDF2 salt (public). */
  salt: string;
  saltSource: 'creator' | 'explicit' | 'random';
  /** Encrypted known value used to detect a wrong passphrase on unlock. */
  verifier: EncryptedEnvelope;
}

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto');
  webcrypto.getRandomValues(bytes);
  return bytes;
}

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback: 128 bits from the CSPRNG (never Math.random).
  return Array.from(getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

function getTextEncoder(): TextEncoder {
  if (typeof globalThis.TextEncoder !== 'undefined') {
    return new globalThis.TextEncoder();
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return new (require('util').TextEncoder)() as TextEncoder;
}

function getTextDecoder(): TextDecoder {
  if (typeof globalThis.TextDecoder !== 'undefined') {
    // fatal: reject invalid UTF-8 instead of silently replacing it.
    return new globalThis.TextDecoder('utf-8', { fatal: true });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return new (require('util').TextDecoder)('utf-8', { fatal: true }) as TextDecoder;
}

function getSubtleCrypto(): SubtleCrypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto');
  return webcrypto.subtle as SubtleCrypto;
}

/** Chunked to avoid call-stack overflow on large payloads. */
export function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function wipe(...buffers: Array<Uint8Array | ArrayBuffer | null | undefined>): void {
  for (const buf of buffers) {
    if (!buf) continue;
    (buf instanceof Uint8Array ? buf : new Uint8Array(buf)).fill(0);
  }
}

function usagesFor(purpose: KeyPurpose): KeyUsage[] {
  return purpose === 'wrap' ? ['wrapKey', 'unwrapKey'] : ['encrypt', 'decrypt'];
}

function assertSupportedAlgorithm(algorithm: KeyAlgorithm): void {
  if (algorithm !== 'AES-GCM') {
    throw new EncryptionError(
      `Unsupported algorithm "${algorithm}": only authenticated AES-GCM is allowed`,
      'UNSUPPORTED_ALGORITHM',
    );
  }
}

/** Build the AAD that binds an envelope to its header and caller context. */
function envelopeAad(kid: string, context: string): Uint8Array {
  return getTextEncoder().encode(
    `${DOMAIN}|v=${ENVELOPE_VERSION}|alg=${ENVELOPE_ALG}|kid=${kid}|ctx=${context}`,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Strictly validate an untrusted envelope (e.g. read back from the indexer).
 * Rejects unknown fields so that plaintext can never ride along in an envelope.
 */
export function validateEnvelope(value: unknown): EncryptedEnvelope {
  const fail = (why: string): never => {
    throw new EncryptionError(`Invalid encrypted envelope: ${why}`, 'INVALID_ENVELOPE');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('not an object');
  const env = value as Record<string, unknown>;
  const allowed = new Set(['version', 'alg', 'kid', 'iv', 'ciphertext']);
  for (const key of Object.keys(env)) {
    if (!allowed.has(key)) fail(`unexpected field "${key}"`);
  }
  if (env.version !== ENVELOPE_VERSION) fail('unsupported version');
  if (env.alg !== ENVELOPE_ALG) fail('unsupported alg');
  if (!isNonEmptyString(env.kid)) fail('missing kid');
  if (!isNonEmptyString(env.iv) || !isNonEmptyString(env.ciphertext)) fail('missing iv/ciphertext');
  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    iv = fromBase64(env.iv as string);
    ct = fromBase64(env.ciphertext as string);
  } catch {
    return fail('malformed base64');
  }
  if (iv.length !== IV_BYTES) fail('iv must be 12 bytes');
  if (ct.length < GCM_TAG_BYTES) fail('ciphertext too short');
  return env as unknown as EncryptedEnvelope;
}

export class EncryptionKeyManager {
  private state: KeyManagerState = {
    keys: new Map(),
    metadata: new Map(),
    activeKeyId: null,
  };

  /** HKDF master key (non-extractable). Null while locked. */
  private masterKey: CryptoKey | null = null;
  /** Per-key count of messages encrypted in this session. */
  private messageCounts = new Map<string, number>();
  /** In-flight re-derivations, so concurrent decrypts share one derive. */
  private pendingDerivations = new Map<string, Promise<CryptoKey>>();

  private readonly storageKey: string;
  private readonly storage: MinimalStorage | null;
  private readonly subtle: SubtleCrypto;
  private readonly maxMessagesPerKey: number;

  constructor(options: KeyManagerOptions = {}) {
    this.storageKey = options.storageKey ?? STORAGE_KEY_DEFAULT;
    this.storage = options.storage === undefined ? this.getDefaultStorage() : options.storage;
    this.subtle = options.crypto ?? getSubtleCrypto();
    this.maxMessagesPerKey = options.maxMessagesPerKey ?? MAX_MESSAGES_PER_KEY_DEFAULT;
    this.loadMetadata();
  }

  // ── Master key: unlock / lock ─────────────────────────────────────────────

  /**
   * Derive the creator's master key from a passphrase and keep it in memory
   * (non-extractable). On first unlock a verifier is persisted so subsequent
   * unlocks with the wrong passphrase fail fast with `WRONG_PASSPHRASE`.
   */
  async unlock(opts: KeyDerivationOptions): Promise<UnlockResult> {
    if (!isNonEmptyString(opts.password)) {
      throw new EncryptionError('A non-empty passphrase is required', 'INVALID_PASSPHRASE');
    }

    const existing = this.loadMasterConfig();
    const hash = existing?.hash ?? opts.hash ?? 'SHA-256';
    const iterations = existing?.iterations ?? opts.iterations ?? PBKDF2_ITERATIONS_DEFAULT;
    if (iterations < PBKDF2_ITERATIONS_MIN) {
      throw new EncryptionError(
        `PBKDF2 iterations must be at least ${PBKDF2_ITERATIONS_MIN}`,
        'KEY_DERIVE_FAILED',
      );
    }

    let salt: Uint8Array;
    let saltSource: MasterConfig['saltSource'];
    if (opts.salt) {
      salt = new Uint8Array(opts.salt);
      saltSource = 'explicit';
    } else if (opts.creator) {
      salt = await this.creatorSalt(opts.creator);
      saltSource = 'creator';
    } else if (existing) {
      salt = fromBase64(existing.salt);
      saltSource = existing.saltSource;
    } else {
      salt = getRandomBytes(SALT_BYTES);
      saltSource = 'random';
    }

    if (existing && toBase64(salt) !== existing.salt) {
      throw new EncryptionError(
        'Creator/salt does not match the key configuration stored on this device',
        'CREATOR_MISMATCH',
      );
    }

    let master: CryptoKey;
    try {
      master = await this.deriveMasterKey(opts.password, salt, iterations, hash);
    } catch (err) {
      throw new EncryptionError('Key derivation failed', 'KEY_DERIVE_FAILED', err);
    }

    const verifierKey = await this.hkdfAesKey(master, salt, `${DOMAIN}:verifier-key`);
    if (existing) {
      try {
        const plain = await this.rawDecrypt(verifierKey, existing.verifier, 'verifier');
        if (plain !== VERIFIER_PLAINTEXT) throw new Error('verifier mismatch');
      } catch (err) {
        throw new EncryptionError('Incorrect passphrase', 'WRONG_PASSPHRASE', err);
      }
      this.masterKey = master;
      return { created: false };
    }

    const verifier = await this.rawEncrypt(verifierKey, 'master-verifier', VERIFIER_PLAINTEXT, 'verifier');
    this.saveMasterConfig({
      v: 1,
      kdf: 'PBKDF2',
      hash,
      iterations,
      salt: toBase64(salt),
      saltSource,
      verifier,
    });
    this.masterKey = master;
    return { created: true };
  }

  /** True when the master key is in memory. */
  isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  /** True when a master key configuration exists on this device. */
  hasMasterConfig(): boolean {
    return this.loadMasterConfig() !== null;
  }

  /**
   * Securely wipe every in-memory key reference. Metadata (public) is kept so
   * derived keys can be re-derived after the next `unlock()`. Generated
   * (non-derived) session keys are lost unless they were wrapped.
   */
  lock(): void {
    this.masterKey = null;
    this.state.keys.clear();
    this.messageCounts.clear();
    this.pendingDerivations.clear();
  }

  /**
   * Derive a new data key from the master key (HKDF, non-extractable).
   * The key becomes active if no active key exists yet.
   */
  async deriveDataKey(label?: string, purpose: KeyPurpose = 'encrypt'): Promise<EncryptionKey> {
    const master = this.requireMaster();
    const id = generateId();
    const derivation: KeyDerivationRecord = {
      kdf: 'HKDF-SHA-256',
      salt: toBase64(getRandomBytes(SALT_BYTES)),
      info: `${DOMAIN}:data-key:${purpose}:${id}`,
    };
    try {
      const cryptoKey = await this.hkdfAesKey(master, fromBase64(derivation.salt), derivation.info, purpose);
      const meta: EncryptionKey = {
        id,
        algorithm: 'AES-GCM',
        purpose,
        status: 'active',
        createdAt: Date.now(),
        label,
        source: 'derived',
        derivation,
      };
      this.registerKey(id, cryptoKey, meta);
      return meta;
    } catch (err) {
      throw new EncryptionError('Data key derivation failed', 'KEY_DERIVE_FAILED', err);
    }
  }

  // ── Key generation ────────────────────────────────────────────────────────

  /**
   * Generate a random session key. Non-extractable by default; pass
   * `{ extractable: true }` only when the key must be wrapped for storage.
   */
  async generateKey(
    purpose: KeyPurpose = 'encrypt',
    algorithm: KeyAlgorithm = 'AES-GCM',
    label?: string,
    options: { extractable?: boolean } = {},
  ): Promise<EncryptionKey> {
    assertSupportedAlgorithm(algorithm);
    try {
      const cryptoKey = await this.subtle.generateKey(
        { name: algorithm, length: AES_KEY_LENGTH },
        options.extractable === true,
        usagesFor(purpose),
      );

      const id = generateId();
      const meta: EncryptionKey = {
        id,
        algorithm,
        purpose,
        status: 'active',
        createdAt: Date.now(),
        label,
        source: 'generated',
      };
      this.registerKey(id, cryptoKey as CryptoKey, meta);
      return meta;
    } catch (err) {
      throw new EncryptionError('Key generation failed', 'KEY_GEN_FAILED', err);
    }
  }

  // ── Legacy password → wrapping key derivation ────────────────────────────

  /**
   * Derive a non-extractable AES-GCM wrapping key from a password (PBKDF2).
   * Prefer `unlock()` + `deriveDataKey()` for new code.
   */
  async deriveKey(opts: KeyDerivationOptions): Promise<EncryptionKey> {
    if (!isNonEmptyString(opts.password)) {
      throw new EncryptionError('A non-empty passphrase is required', 'INVALID_PASSPHRASE');
    }
    let passwordBytes: Uint8Array | null = null;
    try {
      const { iterations = PBKDF2_ITERATIONS_DEFAULT, hash = 'SHA-256' } = opts;
      const salt = opts.salt
        ?? (opts.creator ? await this.creatorSalt(opts.creator) : getRandomBytes(SALT_BYTES));

      passwordBytes = getTextEncoder().encode(opts.password);
      const rawPasswordKey = await this.subtle.importKey(
        'raw',
        passwordBytes as BufferSource,
        'PBKDF2',
        false,
        ['deriveKey'],
      );

      const cryptoKey = await this.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash },
        rawPasswordKey,
        { name: 'AES-GCM', length: AES_KEY_LENGTH },
        false,
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
        source: 'derived',
      };
      this.registerKey(id, cryptoKey, meta);
      return meta;
    } catch (err) {
      throw new EncryptionError('Key derivation failed', 'KEY_DERIVE_FAILED', err);
    } finally {
      wipe(passwordBytes);
    }
  }

  // ── Envelope encrypt / decrypt (preferred) ────────────────────────────────

  /**
   * Encrypt `plaintext` into a versioned envelope bound to `context`
   * (e.g. `task:<id>:args`). The same context must be supplied to decrypt.
   */
  async encryptEnvelope(plaintext: string, context: string, keyId?: string): Promise<EncryptedEnvelope> {
    if (!isNonEmptyString(context)) {
      throw new EncryptionError('An encryption context (e.g. task id + field) is required', 'CONTEXT_REQUIRED');
    }
    const { id, key } = await this.resolveEncryptionKey(keyId);
    try {
      const envelope = await this.rawEncrypt(key, id, plaintext, context);
      this.bumpCount(id);
      return envelope;
    } catch (err) {
      throw new EncryptionError('Encryption failed', 'ENCRYPT_FAILED', err);
    }
  }

  /** Decrypt an envelope produced by `encryptEnvelope` with the same context. */
  async decryptEnvelope(envelope: unknown, context: string): Promise<string> {
    if (!isNonEmptyString(context)) {
      throw new EncryptionError('An encryption context (e.g. task id + field) is required', 'CONTEXT_REQUIRED');
    }
    const env = validateEnvelope(envelope);
    const key = await this.resolveDecryptionKey(env.kid);
    try {
      return await this.rawDecrypt(key, env, context);
    } catch (err) {
      throw new EncryptionError(
        'Decryption failed: ciphertext was tampered with, or the key/context does not match',
        'DECRYPT_FAILED',
        err,
      );
    }
  }

  // ── Legacy encrypt / decrypt ──────────────────────────────────────────────

  async encrypt(plaintext: string, keyId?: string, options: EncryptOptions = {}): Promise<EncryptedPayload> {
    const { id, key } = await this.resolveEncryptionKey(keyId);
    const iv = getRandomBytes(IV_BYTES);
    try {
      const cipherBuffer = await this.subtle.encrypt(
        this.gcmParams(iv, options.additionalData),
        key,
        getTextEncoder().encode(plaintext) as BufferSource,
      );
      this.bumpCount(id);
      return {
        ciphertext: toBase64(cipherBuffer),
        iv: toBase64(iv),
        keyId: id,
        algorithm: 'AES-GCM',
      };
    } catch (err) {
      throw new EncryptionError('Encryption failed', 'ENCRYPT_FAILED', err);
    }
  }

  async decrypt(payload: EncryptedPayload, options: EncryptOptions = {}): Promise<string> {
    const key = await this.resolveDecryptionKey(payload.keyId);
    try {
      assertSupportedAlgorithm(payload.algorithm);
      const iv = fromBase64(payload.iv);
      if (iv.length !== IV_BYTES) throw new Error('invalid iv length');
      const plainBuffer = await this.subtle.decrypt(
        this.gcmParams(iv, options.additionalData),
        key,
        fromBase64(payload.ciphertext) as BufferSource,
      );
      return this.decodePlaintext(plainBuffer);
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
    if (!keyToWrap.extractable) {
      throw new EncryptionError(
        `Key ${keyId} is non-extractable and cannot be wrapped; generate it with { extractable: true }`,
        'KEY_NOT_EXTRACTABLE',
      );
    }

    try {
      const iv = getRandomBytes(IV_BYTES);
      const wrappedBuffer = await this.subtle.wrapKey('raw', keyToWrap, wrappingKey, {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: getTextEncoder().encode(`${DOMAIN}|wrap|kid=${keyId}`) as BufferSource,
      });

      const record: WrappedKeyRecord = {
        keyId,
        wrappedKey: toBase64(wrappedBuffer),
        iv: toBase64(iv),
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

  /** Unwrap a stored key. The restored key is always non-extractable. */
  async unwrapKey(record: WrappedKeyRecord, wrappingKeyId: string): Promise<EncryptionKey> {
    const wrappingKey = this.state.keys.get(wrappingKeyId);
    if (!wrappingKey) {
      throw new EncryptionError(`Wrapping key not found: ${wrappingKeyId}`, 'WRAP_KEY_NOT_FOUND');
    }

    try {
      assertSupportedAlgorithm(record.algorithm);
      const cryptoKey = await this.subtle.unwrapKey(
        'raw',
        fromBase64(record.wrappedKey) as BufferSource,
        wrappingKey,
        {
          name: 'AES-GCM',
          iv: fromBase64(record.iv) as BufferSource,
          additionalData: getTextEncoder().encode(`${DOMAIN}|wrap|kid=${record.keyId}`) as BufferSource,
        },
        { name: record.algorithm, length: AES_KEY_LENGTH },
        false,
        usagesFor(record.purpose),
      );

      const meta: EncryptionKey = {
        id: record.keyId,
        algorithm: record.algorithm,
        purpose: record.purpose,
        status: 'active',
        createdAt: record.createdAt,
        label: record.label,
        source: 'unwrapped',
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

  /**
   * Replace `oldKeyId` with a fresh key. The old key is marked `rotated`: it
   * can still decrypt existing envelopes (looked up by `kid`) but is never used
   * for new encryption. Derived keys rotate to new derived keys when unlocked.
   */
  async rotateKey(oldKeyId: string): Promise<RotationResult> {
    const oldMeta = this.state.metadata.get(oldKeyId);
    if (!oldMeta) {
      throw new EncryptionError(`Key to rotate not found: ${oldKeyId}`, 'KEY_NOT_FOUND');
    }
    if (oldMeta.status === 'revoked') {
      throw new EncryptionError(`Key ${oldKeyId} is revoked and cannot be rotated`, 'KEY_REVOKED');
    }

    // Derived keys must rotate to derived keys (so they survive reloads);
    // deriveDataKey throws LOCKED if the master key is not in memory.
    const newMeta = oldMeta.derivation
      ? await this.deriveDataKey(oldMeta.label, oldMeta.purpose)
      : await this.generateKey(oldMeta.purpose, 'AES-GCM', oldMeta.label);

    const rotatedAt = Date.now();
    this.state.metadata.set(oldKeyId, { ...oldMeta, status: 'rotated', rotatedAt });

    if (this.state.activeKeyId === oldKeyId || this.state.activeKeyId === null) {
      this.state.activeKeyId = newMeta.id;
    }

    this.persistMetadata();
    return { oldKeyId, newKeyId: newMeta.id, rotatedAt };
  }

  /** Revoke a key: it is dropped from memory and can never be re-derived. */
  revokeKey(keyId: string): void {
    const meta = this.state.metadata.get(keyId);
    if (!meta) return;

    this.state.metadata.set(keyId, { ...meta, status: 'revoked' });
    this.state.keys.delete(keyId);
    this.messageCounts.delete(keyId);

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
    const meta = this.state.metadata.get(keyId);
    if (!meta) {
      throw new EncryptionError(`Key not found: ${keyId}`, 'KEY_NOT_FOUND');
    }
    if (meta.status !== 'active') {
      throw new EncryptionError(`Key ${keyId} is ${meta.status} and cannot be made active`, 'KEY_NOT_ACTIVE');
    }
    this.state.activeKeyId = keyId;
    this.persistMetadata();
  }

  getKeyMetadata(keyId: string): EncryptionKey | undefined {
    return this.state.metadata.get(keyId);
  }

  listKeys(): EncryptionKey[] {
    return Array.from(this.state.metadata.values());
  }

  /** True when usable key material for `keyId` is currently in memory. */
  hasKey(keyId: string): boolean {
    return this.state.keys.has(keyId);
  }

  /** Number of messages encrypted under `keyId` in this session. */
  getMessageCount(keyId: string): number {
    return this.messageCounts.get(keyId) ?? 0;
  }

  // ── Export / Import (raw bytes) ───────────────────────────────────────────

  /**
   * Export raw key bytes. Only possible for keys explicitly created with
   * `{ extractable: true }`; every other key throws `KEY_NOT_EXTRACTABLE`.
   */
  async exportKey(keyId: string): Promise<ArrayBuffer> {
    const cryptoKey = this.state.keys.get(keyId);
    if (!cryptoKey) {
      throw new EncryptionError(`Key not found: ${keyId}`, 'KEY_NOT_FOUND');
    }
    if (!cryptoKey.extractable) {
      throw new EncryptionError(`Key ${keyId} is non-extractable`, 'KEY_NOT_EXTRACTABLE');
    }
    try {
      return await this.subtle.exportKey('raw', cryptoKey);
    } catch (err) {
      throw new EncryptionError('Key export failed', 'EXPORT_FAILED', err);
    }
  }

  /** Import raw key bytes as a non-extractable key (unless opted in). */
  async importKey(
    rawKey: ArrayBuffer,
    purpose: KeyPurpose = 'encrypt',
    algorithm: KeyAlgorithm = 'AES-GCM',
    label?: string,
    options: { extractable?: boolean } = {},
  ): Promise<EncryptionKey> {
    assertSupportedAlgorithm(algorithm);
    try {
      const cryptoKey = await this.subtle.importKey(
        'raw',
        rawKey,
        { name: algorithm, length: AES_KEY_LENGTH },
        options.extractable === true,
        usagesFor(purpose),
      );

      const id = generateId();
      const meta: EncryptionKey = {
        id,
        algorithm,
        purpose,
        status: 'active',
        createdAt: Date.now(),
        label,
        source: 'imported',
      };
      this.registerKey(id, cryptoKey, meta);
      return meta;
    } catch (err) {
      throw new EncryptionError('Key import failed', 'IMPORT_FAILED', err);
    }
  }

  // ── Internals: crypto primitives ──────────────────────────────────────────

  private gcmParams(iv: Uint8Array, additionalData?: string): AesGcmParams {
    const params: AesGcmParams = { name: 'AES-GCM', iv: iv as BufferSource, tagLength: GCM_TAG_BYTES * 8 };
    if (additionalData !== undefined) {
      params.additionalData = getTextEncoder().encode(additionalData) as BufferSource;
    }
    return params;
  }

  private async rawEncrypt(key: CryptoKey, kid: string, plaintext: string, context: string): Promise<EncryptedEnvelope> {
    const iv = getRandomBytes(IV_BYTES);
    const data = getTextEncoder().encode(plaintext);
    try {
      const ct = await this.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: envelopeAad(kid, context) as BufferSource, tagLength: 128 },
        key,
        data as BufferSource,
      );
      return { version: ENVELOPE_VERSION, alg: ENVELOPE_ALG, kid, iv: toBase64(iv), ciphertext: toBase64(ct) };
    } finally {
      wipe(data);
    }
  }

  private async rawDecrypt(key: CryptoKey, env: EncryptedEnvelope, context: string): Promise<string> {
    const plain = await this.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(env.iv) as BufferSource,
        additionalData: envelopeAad(env.kid, context) as BufferSource,
        tagLength: 128,
      },
      key,
      fromBase64(env.ciphertext) as BufferSource,
    );
    return this.decodePlaintext(plain);
  }

  private decodePlaintext(buffer: ArrayBuffer): string {
    try {
      return getTextDecoder().decode(buffer);
    } finally {
      wipe(buffer);
    }
  }

  private async creatorSalt(creator: string): Promise<Uint8Array> {
    const digest = await this.subtle.digest(
      'SHA-256',
      getTextEncoder().encode(`${DOMAIN}:pbkdf2-salt:${creator.trim()}`) as BufferSource,
    );
    return new Uint8Array(digest).slice(0, SALT_BYTES);
  }

  private async deriveMasterKey(
    password: string,
    salt: Uint8Array,
    iterations: number,
    hash: 'SHA-256' | 'SHA-512',
  ): Promise<CryptoKey> {
    const passwordBytes = getTextEncoder().encode(password);
    let bits: ArrayBuffer | null = null;
    try {
      const pbkdf2Key = await this.subtle.importKey('raw', passwordBytes as BufferSource, 'PBKDF2', false, ['deriveBits']);
      bits = await this.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash },
        pbkdf2Key,
        256,
      );
      return await this.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey', 'deriveBits']);
    } finally {
      wipe(passwordBytes, bits);
    }
  }

  private async hkdfAesKey(
    master: CryptoKey,
    salt: Uint8Array,
    info: string,
    purpose: KeyPurpose = 'encrypt',
  ): Promise<CryptoKey> {
    return this.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: getTextEncoder().encode(info) as BufferSource },
      master,
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      false,
      usagesFor(purpose),
    );
  }

  private requireMaster(): CryptoKey {
    if (!this.masterKey) {
      throw new EncryptionError('Key manager is locked; unlock with your passphrase first', 'LOCKED');
    }
    return this.masterKey;
  }

  private registerKey(id: string, key: CryptoKey, meta: EncryptionKey): void {
    this.state.keys.set(id, key);
    this.state.metadata.set(id, meta);
    if (!this.state.activeKeyId) this.state.activeKeyId = id;
    this.persistMetadata();
  }

  private bumpCount(keyId: string): void {
    this.messageCounts.set(keyId, (this.messageCounts.get(keyId) ?? 0) + 1);
  }

  private async resolveEncryptionKey(keyId?: string): Promise<{ id: string; key: CryptoKey }> {
    const id = keyId ?? this.state.activeKeyId;
    if (!id) {
      throw new EncryptionError('No active key available for encryption', 'NO_ACTIVE_KEY');
    }
    const meta = this.state.metadata.get(id);
    if (!meta && !this.state.keys.has(id)) {
      throw new EncryptionError(`Key not found: ${id}`, 'KEY_NOT_FOUND');
    }
    if (meta && meta.status !== 'active') {
      throw new EncryptionError(
        `Key ${id} is ${meta.status}; new data must be encrypted with an active key`,
        meta.status === 'revoked' ? 'KEY_REVOKED' : 'KEY_NOT_ACTIVE',
      );
    }
    if (meta && meta.purpose !== 'encrypt') {
      throw new EncryptionError(`Key ${id} is a ${meta.purpose} key, not an encryption key`, 'KEY_PURPOSE_MISMATCH');
    }
    if (meta) assertSupportedAlgorithm(meta.algorithm);
    if (this.getMessageCount(id) >= this.maxMessagesPerKey) {
      throw new EncryptionError(
        `Key ${id} reached its message limit; rotate the key before encrypting more data`,
        'KEY_USAGE_LIMIT',
      );
    }
    const key = await this.loadKeyMaterial(id);
    return { id, key };
  }

  private async resolveDecryptionKey(keyId: string): Promise<CryptoKey> {
    const meta = this.state.metadata.get(keyId);
    if (meta?.status === 'revoked') {
      throw new EncryptionError(`Key ${keyId} has been revoked`, 'KEY_REVOKED');
    }
    if (!meta && !this.state.keys.has(keyId)) {
      throw new EncryptionError(`Key not found for decryption: ${keyId}`, 'KEY_NOT_FOUND');
    }
    return this.loadKeyMaterial(keyId);
  }

  /** In-memory cache first, then lazy HKDF re-derivation for derived keys. */
  private async loadKeyMaterial(keyId: string): Promise<CryptoKey> {
    const cached = this.state.keys.get(keyId);
    if (cached) return cached;

    const meta = this.state.metadata.get(keyId);
    if (!meta?.derivation) {
      throw new EncryptionError(`Key material not available in this session: ${keyId}`, 'KEY_NOT_FOUND');
    }
    const master = this.requireMaster();

    let pending = this.pendingDerivations.get(keyId);
    if (!pending) {
      const derivation = meta.derivation;
      pending = this.hkdfAesKey(master, fromBase64(derivation.salt), derivation.info, meta.purpose)
        .then((key) => {
          // Only cache if we were not locked while deriving.
          if (this.masterKey === master) this.state.keys.set(keyId, key);
          return key;
        })
        .finally(() => this.pendingDerivations.delete(keyId));
      this.pendingDerivations.set(keyId, pending);
    }
    try {
      return await pending;
    } catch (err) {
      throw new EncryptionError('Data key derivation failed', 'KEY_DERIVE_FAILED', err);
    }
  }

  // ── Persistence helpers (public metadata only — never key bytes) ─────────

  private getDefaultStorage(): MinimalStorage | null {
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
        for (const entry of parsed.metadata) {
          if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
          const meta = entry[1] as EncryptionKey;
          if (!meta || typeof meta !== 'object' || meta.id !== entry[0]) continue;
          this.state.metadata.set(entry[0], meta);
        }
      }
      if (typeof parsed.activeKeyId === 'string' && this.state.metadata.has(parsed.activeKeyId)) {
        this.state.activeKeyId = parsed.activeKeyId;
      }
    } catch {
      // Corrupted storage — start fresh
    }
  }

  private loadMasterConfig(): MasterConfig | null {
    if (!this.storage) return this.memoryMasterConfig;
    try {
      const raw = this.storage.getItem(`${this.storageKey}_master`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MasterConfig;
      if (parsed?.v !== 1 || typeof parsed.salt !== 'string' || !parsed.verifier) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Used when no storage is available (SSR / tests), so lock/unlock still verifies. */
  private memoryMasterConfig: MasterConfig | null = null;

  private saveMasterConfig(config: MasterConfig): void {
    this.memoryMasterConfig = config;
    if (!this.storage) return;
    try {
      this.storage.setItem(`${this.storageKey}_master`, JSON.stringify(config));
    } catch {
      // best-effort
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

  /** Wipe all in-memory keys AND all persisted metadata for this manager. */
  clearStorage(): void {
    if (this.storage) {
      try {
        this.storage.removeItem(this.storageKey);
        this.storage.removeItem(`${this.storageKey}_master`);
        for (const keyId of this.state.metadata.keys()) {
          this.storage.removeItem(`${this.storageKey}_wrapped_${keyId}`);
        }
      } catch {
        // best-effort
      }
    }
    this.lock();
    this.memoryMasterConfig = null;
    this.state = { keys: new Map(), metadata: new Map(), activeKeyId: null };
  }

  private findNextActiveKeyId(): string | null {
    for (const [id, meta] of this.state.metadata) {
      if (meta.status === 'active' && meta.purpose === 'encrypt' && (this.state.keys.has(id) || meta.derivation)) {
        return id;
      }
    }
    return null;
  }
}
