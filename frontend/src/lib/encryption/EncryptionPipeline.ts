import { EncryptionKeyManager } from './EncryptionKeyManager';
import { EncryptedPayload, EncryptionError, KeyDerivationOptions, RotationResult } from './types';

export interface PipelineOptions {
  manager: EncryptionKeyManager;
  enableErrorTracking?: boolean;
  maxRetries?: number;
}

export interface PipelineResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  retries?: number;
}

export class EncryptionPipeline {
  private readonly manager: EncryptionKeyManager;
  private readonly maxRetries: number;
  private readonly enableErrorTracking: boolean;

  constructor(options: PipelineOptions) {
    this.manager = options.manager;
    this.maxRetries = options.maxRetries ?? 2;
    this.enableErrorTracking = options.enableErrorTracking ?? true;
  }

  // ── Fault-tolerant encrypt ─────────────────────────────────────────────

  async safeEncrypt(plaintext: string, keyId?: string): Promise<PipelineResult<EncryptedPayload>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const data = await this.manager.encrypt(plaintext, keyId);
        return { success: true, data, retries: attempt };
      } catch (err) {
        lastError = err;
        this.trackError('encrypt', err, attempt);
        if (err instanceof EncryptionError && err.code === 'KEY_NOT_FOUND') break; // no point retrying
      }
    }
    return { success: false, error: this.errorMessage(lastError), retries: this.maxRetries };
  }

  // ── Fault-tolerant decrypt ─────────────────────────────────────────────

  async safeDecrypt(payload: EncryptedPayload): Promise<PipelineResult<string>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const data = await this.manager.decrypt(payload);
        return { success: true, data, retries: attempt };
      } catch (err) {
        lastError = err;
        this.trackError('decrypt', err, attempt);
        if (err instanceof EncryptionError && err.code === 'KEY_NOT_FOUND') break;
      }
    }
    return { success: false, error: this.errorMessage(lastError), retries: this.maxRetries };
  }

  // ── Bootstrap pipeline (derive + make first key) ──────────────────────

  async bootstrap(opts: KeyDerivationOptions): Promise<PipelineResult<string>> {
    try {
      const derived = await this.manager.deriveKey(opts);
      const encryption = await this.manager.generateKey('encrypt', 'AES-GCM', 'data-key');
      await this.manager.wrapKey(encryption.id, derived.id);
      this.manager.setActiveKeyId(encryption.id);
      return { success: true, data: encryption.id };
    } catch (err) {
      console.error('BOOTSTRAP_ERR', err);
      this.trackError('bootstrap', err, 0);
      return { success: false, error: this.errorMessage(err) };
    }
  }

  // ── Key rotation pipeline ─────────────────────────────────────────────

  async safeRotateKey(oldKeyId: string): Promise<PipelineResult<RotationResult>> {
    try {
      const result = await this.manager.rotateKey(oldKeyId);
      return { success: true, data: result };
    } catch (err) {
      this.trackError('rotate', err, 0);
      return { success: false, error: this.errorMessage(err) };
    }
  }

  // ── Re-encrypt data under the new active key ──────────────────────────

  async reEncrypt(payload: EncryptedPayload): Promise<PipelineResult<EncryptedPayload>> {
    const decryptResult = await this.safeDecrypt(payload);
    if (!decryptResult.success || decryptResult.data === undefined) {
      return { success: false, error: decryptResult.error };
    }
    return this.safeEncrypt(decryptResult.data);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private trackError(operation: string, err: unknown, attempt: number): void {
    if (!this.enableErrorTracking) return;
    const message = this.errorMessage(err);
    console.error(`[EncryptionPipeline:${operation}] attempt=${attempt} error=${message}`);
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err ?? 'Unknown error');
  }
}
