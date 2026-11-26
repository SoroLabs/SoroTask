import { EncryptionKeyManager } from './EncryptionKeyManager';
import {
  EncryptedEnvelope,
  EncryptedPayload,
  EncryptionError,
  KeyDerivationOptions,
  RotationResult,
} from './types';

/**
 * Only transient Web Crypto failures are worth retrying. Authentication
 * failures, missing/revoked keys, a locked manager, and malformed envelopes are
 * deterministic: retrying them only burns CPU and delays the error.
 */
const RETRYABLE_CODES = new Set(['ENCRYPT_FAILED']);

function isRetryable(err: unknown): boolean {
  return !(err instanceof EncryptionError) || RETRYABLE_CODES.has(err.code);
}

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
        if (!isRetryable(err)) break; // no point retrying
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
        if (!isRetryable(err)) break;
      }
    }
    return { success: false, error: this.errorMessage(lastError), retries: this.maxRetries };
  }

  // ── Bootstrap pipeline (unlock master + ensure a derived data key) ───────

  /**
   * Unlock the creator's master key (PBKDF2 → HKDF) and make sure an active,
   * re-derivable data key exists. On a returning device the existing active
   * derived key is reused, so previously encrypted envelopes stay decryptable.
   * Resolves to the active data key id.
   */
  async bootstrap(opts: KeyDerivationOptions): Promise<PipelineResult<string>> {
    try {
      await this.manager.unlock(opts);
      const activeId = this.manager.getActiveKeyId();
      const activeMeta = activeId ? this.manager.getKeyMetadata(activeId) : undefined;
      if (activeId && activeMeta?.status === 'active' && activeMeta.purpose === 'encrypt' && activeMeta.derivation) {
        return { success: true, data: activeId };
      }
      const dataKey = await this.manager.deriveDataKey('data-key');
      this.manager.setActiveKeyId(dataKey.id);
      return { success: true, data: dataKey.id };
    } catch (err) {
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

  /**
   * Migrate an envelope to the current active key (e.g. after rotation)
   * without the plaintext ever leaving this function.
   */
  async reEncryptEnvelope(
    envelope: EncryptedEnvelope,
    context: string,
  ): Promise<PipelineResult<EncryptedEnvelope>> {
    try {
      const plaintext = await this.manager.decryptEnvelope(envelope, context);
      const data = await this.manager.encryptEnvelope(plaintext, context);
      return { success: true, data };
    } catch (err) {
      this.trackError('reEncryptEnvelope', err, 0);
      return { success: false, error: this.errorMessage(err) };
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private trackError(operation: string, err: unknown, attempt: number): void {
    if (!this.enableErrorTracking) return;
    // Log only the error code/message — never payloads, keys, or the raw cause.
    const code = err instanceof EncryptionError ? err.code : 'UNKNOWN';
    console.error(`[EncryptionPipeline:${operation}] attempt=${attempt} code=${code} error=${this.errorMessage(err)}`);
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err ?? 'Unknown error');
  }
}
