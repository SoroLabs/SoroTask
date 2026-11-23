/**
 * `AES-CBC` is retained in the union only for backward compatibility of
 * persisted metadata. It is unauthenticated and is rejected for any new key
 * or encryption operation — use `AES-GCM`.
 */
export type KeyAlgorithm = 'AES-GCM' | 'AES-CBC';
export type KeyPurpose = 'encrypt' | 'sign' | 'wrap';
export type KeyStatus = 'active' | 'rotated' | 'revoked';
export type KeySource = 'generated' | 'derived' | 'imported' | 'unwrapped';

/**
 * Public (non-secret) parameters needed to re-derive a data key from the
 * creator's master key. Safe to persist: without the master passphrase these
 * values reveal nothing about the key.
 */
export interface KeyDerivationRecord {
  kdf: 'HKDF-SHA-256';
  /** base64-encoded per-key HKDF salt (16 random bytes). */
  salt: string;
  /** HKDF info string (domain-separated, includes the key id). */
  info: string;
}

export interface EncryptionKey {
  id: string;
  algorithm: KeyAlgorithm;
  purpose: KeyPurpose;
  status: KeyStatus;
  createdAt: number;
  rotatedAt?: number;
  label?: string;
  /** How the key material came to exist. Absent on legacy metadata. */
  source?: KeySource;
  /** Present for keys derived from the master key (re-derivable after unlock). */
  derivation?: KeyDerivationRecord;
}

export interface WrappedKeyRecord {
  keyId: string;
  wrappedKey: string; // base64-encoded
  iv: string;         // base64-encoded IV used for wrapping
  algorithm: KeyAlgorithm;
  purpose: KeyPurpose;
  createdAt: number;
  label?: string;
}

/** Legacy payload shape returned by `encrypt()` (kept for compatibility). */
export interface EncryptedPayload {
  ciphertext: string; // base64-encoded
  iv: string;         // base64-encoded
  keyId: string;
  algorithm: KeyAlgorithm;
}

export const ENVELOPE_VERSION = 1 as const;
export const ENVELOPE_ALG = 'A256GCM' as const;

/**
 * Versioned, self-describing ciphertext envelope. This is the ONLY shape that
 * should ever be sent to the backend, indexer, or contract for sensitive task
 * data. It contains no plaintext fields: the AAD context (task id + field) is
 * supplied by the caller on both encrypt and decrypt and is never stored.
 */
export interface EncryptedEnvelope {
  version: typeof ENVELOPE_VERSION;
  alg: typeof ENVELOPE_ALG;
  /** Key id used to encrypt; used to look up / re-derive the key for decrypt. */
  kid: string;
  /** base64-encoded 96-bit random IV, unique per message. */
  iv: string;
  /** base64-encoded AES-GCM ciphertext including the 128-bit auth tag. */
  ciphertext: string;
}

export interface EncryptOptions {
  /** Additional authenticated data bound to the ciphertext (not encrypted, not stored). */
  additionalData?: string;
}

export interface KeyDerivationOptions {
  password: string;
  /** Explicit PBKDF2 salt. Overrides `creator`. */
  salt?: Uint8Array;
  /**
   * Creator identity (e.g. the creator's Stellar public key). When provided,
   * the PBKDF2 salt is derived deterministically as
   * SHA-256("sorotask:e2e:v1:pbkdf2-salt:" + creator)[0..16], so the same
   * creator + passphrase re-derives the same master key on any device.
   */
  creator?: string;
  iterations?: number;
  hash?: 'SHA-256' | 'SHA-512';
}

export interface UnlockResult {
  /** True when this unlock created a brand-new master key configuration. */
  created: boolean;
}

export interface RotationResult {
  oldKeyId: string;
  newKeyId: string;
  rotatedAt: number;
}

export interface KeyManagerOptions {
  storageKey?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  crypto?: SubtleCrypto;
  /**
   * Maximum number of messages encrypted under a single key in this session
   * before encryption is refused and rotation is required. Random 96-bit IVs
   * are safe for up to 2^32 messages per key (NIST SP 800-38D); the default is
   * deliberately far below that.
   */
  maxMessagesPerKey?: number;
}

export interface KeyManagerState {
  keys: Map<string, CryptoKey>;
  metadata: Map<string, EncryptionKey>;
  activeKeyId: string | null;
}

export type EncryptionErrorCode =
  | 'KEY_GEN_FAILED'
  | 'KEY_DERIVE_FAILED'
  | 'INVALID_PASSPHRASE'
  | 'WRONG_PASSPHRASE'
  | 'CREATOR_MISMATCH'
  | 'LOCKED'
  | 'NO_ACTIVE_KEY'
  | 'KEY_NOT_FOUND'
  | 'KEY_META_NOT_FOUND'
  | 'KEY_REVOKED'
  | 'KEY_NOT_ACTIVE'
  | 'KEY_PURPOSE_MISMATCH'
  | 'KEY_NOT_EXTRACTABLE'
  | 'KEY_USAGE_LIMIT'
  | 'UNSUPPORTED_ALGORITHM'
  | 'CONTEXT_REQUIRED'
  | 'INVALID_ENVELOPE'
  | 'ENCRYPT_FAILED'
  | 'DECRYPT_FAILED'
  | 'WRAP_KEY_NOT_FOUND'
  | 'WRAP_FAILED'
  | 'UNWRAP_FAILED'
  | 'EXPORT_FAILED'
  | 'IMPORT_FAILED'
  | 'INVALID_PAYLOAD'
  | 'INVALID_WEBHOOK_URL'
  | 'PLAINTEXT_FIELD';

export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: EncryptionErrorCode | string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}
