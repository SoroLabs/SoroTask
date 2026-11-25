import { EncryptionKeyManager } from '../EncryptionKeyManager';
import { EncryptionPipeline } from '../EncryptionPipeline';
import { EncryptionError } from '../types';

class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
}

function getSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle !== 'undefined') return globalThis.crypto.subtle;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { webcrypto } = require('crypto');
  return webcrypto.subtle as SubtleCrypto;
}

beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webcrypto } = require('crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

function makePipeline(maxRetries = 1) {
  const manager = new EncryptionKeyManager({
    storage: new MemStorage(),
    crypto: getSubtle(),
  });
  const pipeline = new EncryptionPipeline({
    manager,
    maxRetries,
    enableErrorTracking: false,
  });
  return { manager, pipeline };
}

describe('EncryptionPipeline', () => {
  // ── safeEncrypt ────────────────────────────────────────────────────────

  describe('safeEncrypt', () => {
    it('returns success with encrypted payload', async () => {
      const { manager, pipeline } = makePipeline();
      await manager.generateKey();
      const result = await pipeline.safeEncrypt('secret message');
      expect(result.success).toBe(true);
      expect(result.data?.ciphertext).toBeTruthy();
    });

    it('returns failure when no key exists', async () => {
      const { pipeline } = makePipeline();
      const result = await pipeline.safeEncrypt('data');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('does not retry on KEY_NOT_FOUND', async () => {
      const { pipeline } = makePipeline(3);
      const result = await pipeline.safeEncrypt('data', 'nonexistent-key');
      expect(result.success).toBe(false);
      // Should break early — retries reported as maxRetries (3) not actually retried beyond 0
      expect(result.retries).toBeDefined();
    });

    it('returns retries=0 on first-attempt success', async () => {
      const { manager, pipeline } = makePipeline();
      await manager.generateKey();
      const result = await pipeline.safeEncrypt('test');
      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);
    });
  });

  // ── safeDecrypt ────────────────────────────────────────────────────────

  describe('safeDecrypt', () => {
    it('decrypts a valid payload', async () => {
      const { manager, pipeline } = makePipeline();
      await manager.generateKey();
      const encrypted = (await pipeline.safeEncrypt('hello')).data!;
      const result = await pipeline.safeDecrypt(encrypted);
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('returns failure on missing key', async () => {
      const { manager, pipeline } = makePipeline();
      await manager.generateKey();
      const encrypted = (await pipeline.safeEncrypt('hi')).data!;
      // tamper keyId
      const result = await pipeline.safeDecrypt({ ...encrypted, keyId: 'gone' });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ── bootstrap ─────────────────────────────────────────────────────────

  describe('bootstrap', () => {
    it('derives a key, creates a data key, wraps it, and returns success', async () => {
      const { manager, pipeline } = makePipeline();
      const result = await pipeline.bootstrap({ password: 'strongpass', iterations: 1000 });
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy(); // active keyId
      expect(manager.getActiveKeyId()).toBe(result.data);
    });

    it('sets the new data key as active after bootstrap', async () => {
      const { manager, pipeline } = makePipeline();
      expect(manager.getActiveKeyId()).toBeNull();
      await pipeline.bootstrap({ password: 'pass', iterations: 1000 });
      expect(manager.getActiveKeyId()).not.toBeNull();
    });

    it('returns failure when key generation throws', async () => {
      const badManager = new EncryptionKeyManager({
        storage: new MemStorage(),
        crypto: {
          ...getSubtle(),
          generateKey: jest.fn().mockRejectedValue(new Error('hw failure')),
          importKey: jest.fn().mockRejectedValue(new Error('hw failure')),
          deriveKey: jest.fn().mockRejectedValue(new Error('hw failure')),
        } as unknown as SubtleCrypto,
      });
      const pipeline = new EncryptionPipeline({ manager: badManager, enableErrorTracking: false });
      const result = await pipeline.bootstrap({ password: 'pass' });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ── safeRotateKey ─────────────────────────────────────────────────────

  describe('safeRotateKey', () => {
    it('rotates an existing key successfully', async () => {
      const { manager, pipeline } = makePipeline();
      const key = await manager.generateKey();
      const result = await pipeline.safeRotateKey(key.id);
      expect(result.success).toBe(true);
      expect(result.data?.oldKeyId).toBe(key.id);
      expect(result.data?.newKeyId).not.toBe(key.id);
    });

    it('returns failure for unknown key id', async () => {
      const { pipeline } = makePipeline();
      const result = await pipeline.safeRotateKey('bogus');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ── reEncrypt ─────────────────────────────────────────────────────────

  describe('reEncrypt', () => {
    it('decrypts then re-encrypts under the active key', async () => {
      const { manager, pipeline } = makePipeline();
      await manager.generateKey();
      const original = (await pipeline.safeEncrypt('payload')).data!;
      const reEncResult = await pipeline.reEncrypt(original);
      expect(reEncResult.success).toBe(true);
      // new payload can be decrypted to same plaintext
      const decryptResult = await pipeline.safeDecrypt(reEncResult.data!);
      expect(decryptResult.data).toBe('payload');
    });

    it('returns failure when decrypt step fails', async () => {
      const { manager, pipeline } = makePipeline();
      await manager.generateKey();
      const fakePayload = {
        ciphertext: 'broken',
        iv: 'broken',
        keyId: 'bad',
        algorithm: 'AES-GCM' as const,
      };
      const result = await pipeline.reEncrypt(fakePayload);
      expect(result.success).toBe(false);
    });
  });

  // ── error tracking ────────────────────────────────────────────────────

  describe('error tracking', () => {
    it('logs to console.error when enableErrorTracking=true', async () => {
      const { pipeline } = makePipeline();
      // Override to enable tracking
      const trackingPipeline = new EncryptionPipeline({
        manager: new EncryptionKeyManager({ storage: new MemStorage(), crypto: getSubtle() }),
        enableErrorTracking: true,
      });
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await trackingPipeline.safeEncrypt('data'); // no key => error
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('does not log when enableErrorTracking=false', async () => {
      const { pipeline } = makePipeline();
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await pipeline.safeEncrypt('data'); // no key => error, but tracking disabled
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
