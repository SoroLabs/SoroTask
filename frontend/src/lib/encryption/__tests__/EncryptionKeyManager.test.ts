import { EncryptionKeyManager } from '../EncryptionKeyManager';
import { EncryptionError } from '../types';

// ── Minimal in-memory storage ────────────────────────────────────────────────

class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
}

// ── Web Crypto mock using Node.js built-in ────────────────────────────────────

// jsdom does not ship a full SubtleCrypto implementation, so we delegate to
// the Node.js webcrypto module that IS available in jest-environment-jsdom v30+.
function getSubtle(): SubtleCrypto {
  // Node 19+ exposes globalThis.crypto.subtle
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    return globalThis.crypto.subtle;
  }
  // Fallback: require the webcrypto module
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { webcrypto } = require('crypto');
  return webcrypto.subtle as SubtleCrypto;
}

// Also ensure globalThis.crypto.getRandomValues is available for IV generation
// inside EncryptionKeyManager (used outside of the injected `subtle`)
beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webcrypto } = require('crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

function makeManager(storage?: MemStorage) {
  return new EncryptionKeyManager({
    storage: storage ?? new MemStorage(),
    crypto: getSubtle(),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EncryptionKeyManager', () => {
  // ── generateKey ────────────────────────────────────────────────────────

  describe('generateKey', () => {
    it('creates an AES-GCM key with active status', async () => {
      const mgr = makeManager();
      const meta = await mgr.generateKey('encrypt', 'AES-GCM', 'my-key');
      expect(meta.id).toBeTruthy();
      expect(meta.algorithm).toBe('AES-GCM');
      expect(meta.purpose).toBe('encrypt');
      expect(meta.status).toBe('active');
      expect(meta.label).toBe('my-key');
      expect(meta.createdAt).toBeGreaterThan(0);
    });

    it('sets the first generated key as active', async () => {
      const mgr = makeManager();
      const meta = await mgr.generateKey();
      expect(mgr.getActiveKeyId()).toBe(meta.id);
    });

    it('subsequent generate calls do not overwrite active key', async () => {
      const mgr = makeManager();
      const first = await mgr.generateKey();
      await mgr.generateKey();
      expect(mgr.getActiveKeyId()).toBe(first.id);
    });

    it('stores the key in-memory (hasKey returns true)', async () => {
      const mgr = makeManager();
      const meta = await mgr.generateKey();
      expect(mgr.hasKey(meta.id)).toBe(true);
    });

    it('persists metadata to storage', async () => {
      const storage = new MemStorage();
      const mgr = makeManager(storage);
      await mgr.generateKey();
      expect(storage.getItem('sorotask_enc_keys')).not.toBeNull();
    });

    it('generates a wrap-purpose key with correct usages', async () => {
      const mgr = makeManager();
      const meta = await mgr.generateKey('wrap', 'AES-GCM');
      expect(meta.purpose).toBe('wrap');
    });
  });

  // ── deriveKey ──────────────────────────────────────────────────────────

  describe('deriveKey', () => {
    it('derives a key from a password', async () => {
      const mgr = makeManager();
      const meta = await mgr.deriveKey({ password: 'secret', iterations: 1000 });
      expect(meta.id).toBeTruthy();
      expect(meta.algorithm).toBe('AES-GCM');
      expect(meta.label).toBe('password-derived');
    });

    it('throws EncryptionError on invalid input', async () => {
      const mgr = makeManager();
      // Pass a deliberately broken subtle to force a failure path
      const badManager = new EncryptionKeyManager({
        storage: new MemStorage(),
        crypto: {
          ...getSubtle(),
          importKey: jest.fn().mockRejectedValue(new Error('bad input')),
        } as unknown as SubtleCrypto,
      });
      await expect(badManager.deriveKey({ password: 'x' })).rejects.toThrow(EncryptionError);
    });
  });

  // ── encrypt / decrypt ──────────────────────────────────────────────────

  describe('encrypt & decrypt', () => {
    it('round-trips plaintext correctly', async () => {
      const mgr = makeManager();
      await mgr.generateKey();
      const payload = await mgr.encrypt('hello world');
      expect(payload.ciphertext).toBeTruthy();
      expect(payload.iv).toBeTruthy();
      const recovered = await mgr.decrypt(payload);
      expect(recovered).toBe('hello world');
    });

    it('encrypts with a specific keyId', async () => {
      const mgr = makeManager();
      const k1 = await mgr.generateKey();
      await mgr.generateKey(); // second key
      const payload = await mgr.encrypt('data', k1.id);
      expect(payload.keyId).toBe(k1.id);
    });

    it('throws when no active key is set', async () => {
      const mgr = makeManager();
      await expect(mgr.encrypt('data')).rejects.toThrow('No active key');
    });

    it('throws when encrypting with missing key', async () => {
      const mgr = makeManager();
      await expect(mgr.encrypt('data', 'nonexistent')).rejects.toThrow(EncryptionError);
    });

    it('throws when decrypting with missing key', async () => {
      const mgr = makeManager();
      await mgr.generateKey();
      const payload = await mgr.encrypt('data');
      // tamper keyId so the key is not found
      await expect(mgr.decrypt({ ...payload, keyId: 'unknown' })).rejects.toThrow(EncryptionError);
    });

    it('produces different ciphertexts for the same plaintext (IV randomness)', async () => {
      const mgr = makeManager();
      await mgr.generateKey();
      const p1 = await mgr.encrypt('same');
      const p2 = await mgr.encrypt('same');
      expect(p1.ciphertext).not.toBe(p2.ciphertext);
      expect(p1.iv).not.toBe(p2.iv);
    });

    it('decrypts unicode strings faithfully', async () => {
      const mgr = makeManager();
      await mgr.generateKey();
      const unicode = '日本語テスト 🔐';
      const payload = await mgr.encrypt(unicode);
      expect(await mgr.decrypt(payload)).toBe(unicode);
    });
  });

  // ── wrapKey / unwrapKey ────────────────────────────────────────────────

  describe('wrapKey & unwrapKey', () => {
    it('wraps a key and persists a WrappedKeyRecord', async () => {
      const storage = new MemStorage();
      const mgr = makeManager(storage);
      const wrapperKey = await mgr.generateKey('wrap');
      const dataKey = await mgr.generateKey('encrypt');

      const record = await mgr.wrapKey(dataKey.id, wrapperKey.id);
      expect(record.wrappedKey).toBeTruthy();
      expect(record.iv).toBeTruthy();
      expect(record.keyId).toBe(dataKey.id);

      // Record is saved to storage
      expect(storage.getItem(`sorotask_enc_keys_wrapped_${dataKey.id}`)).not.toBeNull();
    });

    it('unwraps back to a usable key', async () => {
      const mgr = makeManager();
      const wrapperKey = await mgr.generateKey('wrap');
      const dataKey = await mgr.generateKey('encrypt');
      const record = await mgr.wrapKey(dataKey.id, wrapperKey.id);

      // Remove data key from memory
      mgr.revokeKey(dataKey.id);
      expect(mgr.hasKey(dataKey.id)).toBe(false);

      // Re-import via unwrap
      const restored = await mgr.unwrapKey(record, wrapperKey.id);
      expect(restored.id).toBe(dataKey.id);
      expect(mgr.hasKey(dataKey.id)).toBe(true);
    });

    it('throws when the key to wrap is not found', async () => {
      const mgr = makeManager();
      const wrapperKey = await mgr.generateKey('wrap');
      await expect(mgr.wrapKey('missing', wrapperKey.id)).rejects.toThrow(EncryptionError);
    });

    it('throws when the wrapping key is not found', async () => {
      const mgr = makeManager();
      const dataKey = await mgr.generateKey('encrypt');
      await expect(mgr.wrapKey(dataKey.id, 'missing-wrapper')).rejects.toThrow(EncryptionError);
    });
  });

  // ── rotateKey ──────────────────────────────────────────────────────────

  describe('rotateKey', () => {
    it('creates a new key and marks old key as rotated', async () => {
      const mgr = makeManager();
      const original = await mgr.generateKey();
      const result = await mgr.rotateKey(original.id);

      expect(result.oldKeyId).toBe(original.id);
      expect(result.newKeyId).not.toBe(original.id);
      expect(result.rotatedAt).toBeGreaterThan(0);

      const oldMeta = mgr.getKeyMetadata(original.id);
      expect(oldMeta?.status).toBe('rotated');
      expect(oldMeta?.rotatedAt).toBeDefined();
    });

    it('updates activeKeyId to the new key when rotating the active key', async () => {
      const mgr = makeManager();
      const original = await mgr.generateKey();
      expect(mgr.getActiveKeyId()).toBe(original.id);
      const result = await mgr.rotateKey(original.id);
      expect(mgr.getActiveKeyId()).toBe(result.newKeyId);
    });

    it('throws EncryptionError when key to rotate is not found', async () => {
      const mgr = makeManager();
      await expect(mgr.rotateKey('nonexistent')).rejects.toThrow(EncryptionError);
    });
  });

  // ── revokeKey ──────────────────────────────────────────────────────────

  describe('revokeKey', () => {
    it('marks key as revoked and removes it from in-memory store', async () => {
      const mgr = makeManager();
      const meta = await mgr.generateKey();
      mgr.revokeKey(meta.id);
      expect(mgr.hasKey(meta.id)).toBe(false);
      expect(mgr.getKeyMetadata(meta.id)?.status).toBe('revoked');
    });

    it('silently ignores revoke of unknown key', () => {
      const mgr = makeManager();
      expect(() => mgr.revokeKey('missing')).not.toThrow();
    });

    it('updates activeKeyId when active key is revoked', async () => {
      const mgr = makeManager();
      const k1 = await mgr.generateKey();
      const k2 = await mgr.generateKey();
      mgr.setActiveKeyId(k1.id);
      mgr.revokeKey(k1.id);
      // active should shift to the next live key (k2)
      expect(mgr.getActiveKeyId()).toBe(k2.id);
    });
  });

  // ── setActiveKeyId ────────────────────────────────────────────────────

  describe('setActiveKeyId', () => {
    it('sets an existing key as active', async () => {
      const mgr = makeManager();
      const k1 = await mgr.generateKey();
      const k2 = await mgr.generateKey();
      mgr.setActiveKeyId(k2.id);
      expect(mgr.getActiveKeyId()).toBe(k2.id);
      expect(k1.id).not.toBe(k2.id);
    });

    it('throws when key is unknown', () => {
      const mgr = makeManager();
      expect(() => mgr.setActiveKeyId('bogus')).toThrow(EncryptionError);
    });
  });

  // ── listKeys ──────────────────────────────────────────────────────────

  describe('listKeys', () => {
    it('returns all key metadata', async () => {
      const mgr = makeManager();
      await mgr.generateKey('encrypt', 'AES-GCM', 'a');
      await mgr.generateKey('encrypt', 'AES-GCM', 'b');
      const list = mgr.listKeys();
      expect(list).toHaveLength(2);
    });

    it('returns empty array when no keys exist', () => {
      const mgr = makeManager();
      expect(mgr.listKeys()).toEqual([]);
    });
  });

  // ── exportKey / importKey ─────────────────────────────────────────────

  describe('exportKey & importKey', () => {
    it('exports raw key bytes', async () => {
      const mgr = makeManager();
      const meta = await mgr.generateKey();
      const raw = await mgr.exportKey(meta.id);
      expect(raw.byteLength).toBe(32); // 256-bit AES key = 32 bytes
    });

    it('imports raw key bytes and makes them usable', async () => {
      const mgr = makeManager();
      const original = await mgr.generateKey();
      const rawBuf = await mgr.exportKey(original.id);

      const mgr2 = makeManager();
      const imported = await mgr2.importKey(rawBuf, 'encrypt', 'AES-GCM', 'imported');
      expect(imported.id).toBeTruthy();
      expect(mgr2.hasKey(imported.id)).toBe(true);
    });

    it('throws EncryptionError on export of unknown key', async () => {
      const mgr = makeManager();
      await expect(mgr.exportKey('unknown')).rejects.toThrow(EncryptionError);
    });
  });

  // ── storage hydration ─────────────────────────────────────────────────

  describe('metadata persistence', () => {
    it('rehydrates key metadata from storage on construction', async () => {
      const storage = new MemStorage();
      const mgr1 = makeManager(storage);
      await mgr1.generateKey('encrypt', 'AES-GCM', 'persisted');

      // New manager reads from the same storage
      const mgr2 = new EncryptionKeyManager({ storage, crypto: getSubtle() });
      const list = mgr2.listKeys();
      expect(list).toHaveLength(1);
      expect(list[0].label).toBe('persisted');
    });

    it('getWrappedKey returns null when no record exists', () => {
      const mgr = makeManager();
      expect(mgr.getWrappedKey('nonexistent')).toBeNull();
    });
  });

  // ── clearStorage ──────────────────────────────────────────────────────

  describe('clearStorage', () => {
    it('removes all keys and resets state', async () => {
      const storage = new MemStorage();
      const mgr = makeManager(storage);
      await mgr.generateKey();
      mgr.clearStorage();
      expect(mgr.listKeys()).toHaveLength(0);
      expect(mgr.getActiveKeyId()).toBeNull();
      expect(storage.getItem('sorotask_enc_keys')).toBeNull();
    });
  });

  // ── null storage (SSR) ────────────────────────────────────────────────

  describe('null storage (SSR / no localStorage)', () => {
    it('works in memory without persisting', async () => {
      const mgr = new EncryptionKeyManager({ storage: null, crypto: getSubtle() });
      const meta = await mgr.generateKey();
      expect(meta.id).toBeTruthy();
      expect(mgr.hasKey(meta.id)).toBe(true);
    });
  });
});
