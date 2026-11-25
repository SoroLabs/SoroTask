export type KeyAlgorithm = 'AES-GCM' | 'AES-CBC';
export type KeyPurpose = 'encrypt' | 'sign' | 'wrap';
export type KeyStatus = 'active' | 'rotated' | 'revoked';

export interface EncryptionKey {
  id: string;
  algorithm: KeyAlgorithm;
  purpose: KeyPurpose;
  status: KeyStatus;
  createdAt: number;
  rotatedAt?: number;
  label?: string;
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

export interface EncryptedPayload {
  ciphertext: string; // base64-encoded
  iv: string;         // base64-encoded
  keyId: string;
  algorithm: KeyAlgorithm;
}

export interface KeyDerivationOptions {
  password: string;
  salt?: Uint8Array;
  iterations?: number;
  hash?: 'SHA-256' | 'SHA-512';
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
}

export interface KeyManagerState {
  keys: Map<string, CryptoKey>;
  metadata: Map<string, EncryptionKey>;
  activeKeyId: string | null;
}

export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}
