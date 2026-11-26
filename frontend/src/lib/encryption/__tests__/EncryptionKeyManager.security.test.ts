import { EncryptionKeyManager, fromBase64, toBase64, validateEnvelope } from '../EncryptionKeyManager';
import { EncryptionPipeline } from '../EncryptionPipeline';
import { EncryptedEnvelope, EncryptionError } from '../types';

class MemStorage {
  store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  dump(): string { return Array.from(this.store.values()).join('\n'); }
}

function realSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle !== 'undefined') return globalThis.crypto.subtle;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto').webcrypto.subtle as SubtleCrypto;
}

const SUBTLE_METHODS = [
  'encrypt', 'decrypt', 'deriveKey', 'deriveBits', 'importKey', 'exportKey',
  'generateKey', 'wrapKey', 'unwrapKey', 'digest', 'sign', 'verify',
] as const;

/** A SubtleCrypto whose every method is a pass-through jest.fn spy. */
function spySubtle() {
  const real = realSubtle();
  const spies = {} as Record<(typeof SUBTLE_METHODS)[number], jest.Mock>;
  for (const m of SUBTLE_METHODS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spies[m] = jest.fn((...args: any[]) => (real as any)[m](...args));
  }
  return { subtle: spies as unknown as SubtleCrypto, spies };
}

beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { webcrypto } = require('crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const PASS = 'correct horse battery staple';
const CREATOR = 'GCREATORPUBLICKEYEXAMPLE0000000000000000000000000000000';
const ITER = 1000; // fast for tests; production default is 600k

function makeManager(storage: MemStorage | null = new MemStorage(), extra: { maxMessagesPerKey?: number; crypto?: SubtleCrypto } = {}) {
  return new EncryptionKeyManager({ storage, crypto: extra.crypto ?? realSubtle(), maxMessagesPerKey: extra.maxMessagesPerKey });
}

async function unlocked(storage = new MemStorage(), password = PASS) {
  const mgr = makeManager(storage);
  await mgr.unlock({ password, creator: CREATOR, iterations: ITER });
  const key = await mgr.deriveDataKey('data-key');
  return { mgr, storage, key };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(EncryptionError);
  await expect(p).rejects.toMatchObject({ code });
}

function flipByte(b64: string, index = 0): string {
  const bytes = fromBase64(b64);
  bytes[index] ^= 0x01;
  return toBase64(bytes);
}

describe('EncryptionKeyManager — E2E security properties', () => {
  // ── envelope format ─────────────────────────────────────────────────────

  describe('envelope', () => {
    it('round-trips plaintext bound to a context', async () => {
      const { mgr } = await unlocked();
      const env = await mgr.encryptEnvelope('{"amount":42}', 'task:1:args');
      expect(await mgr.decryptEnvelope(env, 'task:1:args')).toBe('{"amount":42}');
    });

    it('contains exactly version, alg, kid, iv, ciphertext and no plaintext', async () => {
      const { mgr, key } = await unlocked();
      const secret = 'https://hooks.example.com/super-secret-token-123';
      const env = await mgr.encryptEnvelope(secret, 'task:7:webhook.url');
      expect(Object.keys(env).sort()).toEqual(['alg', 'ciphertext', 'iv', 'kid', 'version']);
      expect(env.version).toBe(1);
      expect(env.alg).toBe('A256GCM');
      expect(env.kid).toBe(key.id);
      expect(fromBase64(env.iv)).toHaveLength(12);
      // ciphertext = plaintext length + 16-byte GCM tag
      expect(fromBase64(env.ciphertext)).toHaveLength(new TextEncoder().encode(secret).length + 16);

      const serialized = JSON.stringify(env);
      expect(serialized).not.toContain('super-secret-token');
      expect(serialized).not.toContain('hooks.example.com');
      expect(serialized).not.toContain(toBase64(new TextEncoder().encode(secret)));
      expect(serialized).not.toContain('task:7'); // context is AAD, never stored
    });

    it('uses a fresh random 96-bit IV for every message', async () => {
      const { mgr } = await unlocked();
      const ivs = new Set<string>();
      const cts = new Set<string>();
      for (let i = 0; i < 300; i += 1) {
        const env = await mgr.encryptEnvelope('same plaintext', 'task:1:args');
        ivs.add(env.iv);
        cts.add(env.ciphertext);
      }
      expect(ivs.size).toBe(300);
      expect(cts.size).toBe(300);
    });

    it('handles large payloads (chunked base64)', async () => {
      const { mgr } = await unlocked();
      const big = 'x'.repeat(1_000_000);
      const env = await mgr.encryptEnvelope(big, 'task:big:args');
      expect(await mgr.decryptEnvelope(env, 'task:big:args')).toBe(big);
    });

    it('requires a context', async () => {
      const { mgr } = await unlocked();
      await expectCode(mgr.encryptEnvelope('x', ''), 'CONTEXT_REQUIRED');
      const env = await mgr.encryptEnvelope('x', 'ctx');
      await expectCode(mgr.decryptEnvelope(env, ''), 'CONTEXT_REQUIRED');
    });
  });

  // ── integrity ───────────────────────────────────────────────────────────

  describe('tamper detection', () => {
    let mgr: EncryptionKeyManager;
    let env: EncryptedEnvelope;
    beforeEach(async () => {
      ({ mgr } = await unlocked());
      env = await mgr.encryptEnvelope('webhook-secret', 'task:1:webhook.secret');
    });

    it('rejects a modified ciphertext byte', async () => {
      await expectCode(mgr.decryptEnvelope({ ...env, ciphertext: flipByte(env.ciphertext) }, 'task:1:webhook.secret'), 'DECRYPT_FAILED');
    });

    it('rejects a modified auth tag', async () => {
      const len = fromBase64(env.ciphertext).length;
      await expectCode(mgr.decryptEnvelope({ ...env, ciphertext: flipByte(env.ciphertext, len - 1) }, 'task:1:webhook.secret'), 'DECRYPT_FAILED');
    });

    it('rejects a modified IV', async () => {
      await expectCode(mgr.decryptEnvelope({ ...env, iv: flipByte(env.iv) }, 'task:1:webhook.secret'), 'DECRYPT_FAILED');
    });

    it('rejects the envelope under a different task id or field (AAD binding)', async () => {
      await expectCode(mgr.decryptEnvelope(env, 'task:2:webhook.secret'), 'DECRYPT_FAILED');
      await expectCode(mgr.decryptEnvelope(env, 'task:1:webhook.url'), 'DECRYPT_FAILED');
    });

    it('rejects an envelope re-labelled with another key id', async () => {
      const other = await mgr.deriveDataKey('other');
      await expectCode(mgr.decryptEnvelope({ ...env, kid: other.id }, 'task:1:webhook.secret'), 'DECRYPT_FAILED');
    });

    it('error messages never echo plaintext or context', async () => {
      try {
        await mgr.decryptEnvelope({ ...env, ciphertext: flipByte(env.ciphertext) }, 'task:1:webhook.secret');
      } catch (err) {
        expect((err as Error).message).not.toContain('webhook-secret');
      }
    });
  });

  describe('validateEnvelope', () => {
    it.each([
      ['non-object', 'nope'],
      ['array', []],
      ['extra plaintext field', { version: 1, alg: 'A256GCM', kid: 'k', iv: toBase64(new Uint8Array(12)), ciphertext: toBase64(new Uint8Array(16)), plaintext: 'leak' }],
      ['wrong version', { version: 2, alg: 'A256GCM', kid: 'k', iv: toBase64(new Uint8Array(12)), ciphertext: toBase64(new Uint8Array(16)) }],
      ['wrong alg', { version: 1, alg: 'A128CBC', kid: 'k', iv: toBase64(new Uint8Array(12)), ciphertext: toBase64(new Uint8Array(16)) }],
      ['missing kid', { version: 1, alg: 'A256GCM', iv: toBase64(new Uint8Array(12)), ciphertext: toBase64(new Uint8Array(16)) }],
      ['short iv', { version: 1, alg: 'A256GCM', kid: 'k', iv: toBase64(new Uint8Array(8)), ciphertext: toBase64(new Uint8Array(16)) }],
      ['short ciphertext', { version: 1, alg: 'A256GCM', kid: 'k', iv: toBase64(new Uint8Array(12)), ciphertext: toBase64(new Uint8Array(4)) }],
      ['bad base64', { version: 1, alg: 'A256GCM', kid: 'k', iv: '%%%', ciphertext: '%%%' }],
    ])('rejects %s', (_name, value) => {
      expect(() => validateEnvelope(value)).toThrow(expect.objectContaining({ code: 'INVALID_ENVELOPE' }));
    });
  });

  // ── key handling ────────────────────────────────────────────────────────

  describe('non-extractable keys', () => {
    it('derived data keys and generated keys cannot be exported', async () => {
      const { mgr, key } = await unlocked();
      await expectCode(mgr.exportKey(key.id), 'KEY_NOT_EXTRACTABLE');
      const generated = await mgr.generateKey();
      await expectCode(mgr.exportKey(generated.id), 'KEY_NOT_EXTRACTABLE');
    });

    it('imported keys are non-extractable unless opted in', async () => {
      const mgr = makeManager();
      const imported = await mgr.importKey(new Uint8Array(32).buffer);
      await expectCode(mgr.exportKey(imported.id), 'KEY_NOT_EXTRACTABLE');
    });

    it('refuses to wrap a non-extractable key', async () => {
      const mgr = makeManager();
      const wrapper = await mgr.generateKey('wrap');
      const data = await mgr.generateKey();
      await expectCode(mgr.wrapKey(data.id, wrapper.id), 'KEY_NOT_EXTRACTABLE');
    });

    it('unwrapped keys are restored as non-extractable', async () => {
      const mgr = makeManager();
      const wrapper = await mgr.generateKey('wrap');
      const data = await mgr.generateKey('encrypt', 'AES-GCM', undefined, { extractable: true });
      const record = await mgr.wrapKey(data.id, wrapper.id);
      mgr.revokeKey(data.id);
      await mgr.unwrapKey(record, wrapper.id);
      await expectCode(mgr.exportKey(data.id), 'KEY_NOT_EXTRACTABLE');
    });

    it('never calls exportKey and never persists key bytes or the passphrase', async () => {
      const { subtle, spies } = spySubtle();
      const storage = new MemStorage();
      const mgr = makeManager(storage, { crypto: subtle });
      await mgr.unlock({ password: PASS, creator: CREATOR, iterations: ITER });
      await mgr.deriveDataKey('data-key');
      await mgr.encryptEnvelope('payload-plaintext', 'task:1:args');
      await mgr.rotateKey(mgr.getActiveKeyId()!);

      expect(spies.exportKey).not.toHaveBeenCalled();
      // every CryptoKey produced by derive/import is non-extractable
      for (const call of spies.deriveKey.mock.calls) expect(call[3]).toBe(false);
      for (const call of spies.importKey.mock.calls) expect(call[3]).toBe(false);

      const dump = storage.dump();
      expect(dump).not.toContain(PASS);
      expect(dump).not.toContain('payload-plaintext');
      expect(dump).not.toMatch(/"(k|rawKey|keyBytes|password)"\s*:/);
    });

    it('rejects AES-CBC (unauthenticated) keys', async () => {
      const mgr = makeManager();
      await expectCode(mgr.generateKey('encrypt', 'AES-CBC'), 'UNSUPPORTED_ALGORITHM');
    });
  });

  // ── master key / passphrase ─────────────────────────────────────────────

  describe('unlock', () => {
    it('rejects an empty passphrase and too-few iterations', async () => {
      const mgr = makeManager();
      await expectCode(mgr.unlock({ password: '' }), 'INVALID_PASSPHRASE');
      await expectCode(mgr.unlock({ password: 'x', iterations: 10 }), 'KEY_DERIVE_FAILED');
    });

    it('detects a wrong passphrase on a returning device', async () => {
      const { storage } = await unlocked();
      const again = makeManager(storage);
      await expectCode(again.unlock({ password: 'wrong', creator: CREATOR }), 'WRONG_PASSPHRASE');
      expect(again.isUnlocked()).toBe(false);
      await expect(again.unlock({ password: PASS, creator: CREATOR })).resolves.toEqual({ created: false });
    });

    it('detects a different creator on the same device', async () => {
      const { storage } = await unlocked();
      await expectCode(makeManager(storage).unlock({ password: PASS, creator: 'GOTHER' }), 'CREATOR_MISMATCH');
    });

    it('re-derives the same keys from creator + passphrase on another device', async () => {
      const { mgr, storage } = await unlocked();
      const env = await mgr.encryptEnvelope('portable', 'task:9:args');

      // Device B only receives the public key metadata (no master config, no key bytes).
      const deviceB = new MemStorage();
      deviceB.setItem('sorotask_enc_keys', storage.getItem('sorotask_enc_keys')!);
      const mgrB = makeManager(deviceB);
      await mgrB.unlock({ password: PASS, creator: CREATOR, iterations: ITER });
      expect(await mgrB.decryptEnvelope(env, 'task:9:args')).toBe('portable');
    });

    it('a different passphrase cannot decrypt (wrong key)', async () => {
      const { mgr, storage } = await unlocked();
      const env = await mgr.encryptEnvelope('private', 'task:9:args');
      const deviceB = new MemStorage();
      deviceB.setItem('sorotask_enc_keys', storage.getItem('sorotask_enc_keys')!);
      const attacker = makeManager(deviceB);
      await attacker.unlock({ password: 'guess', creator: CREATOR, iterations: ITER });
      await expectCode(attacker.decryptEnvelope(env, 'task:9:args'), 'DECRYPT_FAILED');
    });

    it('a manager without the key cannot decrypt', async () => {
      const { mgr } = await unlocked();
      const env = await mgr.encryptEnvelope('private', 'task:9:args');
      await expectCode(makeManager().decryptEnvelope(env, 'task:9:args'), 'KEY_NOT_FOUND');
    });

    it('works with no storage (SSR) and still verifies the passphrase', async () => {
      const mgr = makeManager(null);
      await mgr.unlock({ password: PASS, iterations: ITER });
      mgr.lock();
      await expectCode(mgr.unlock({ password: 'nope' }), 'WRONG_PASSPHRASE');
    });
  });

  // ── lock / wipe ─────────────────────────────────────────────────────────

  describe('lock', () => {
    it('wipes in-memory keys; data is recoverable only after unlocking again', async () => {
      const { mgr, key } = await unlocked();
      const env = await mgr.encryptEnvelope('secret', 'task:1:args');
      mgr.lock();
      expect(mgr.isUnlocked()).toBe(false);
      expect(mgr.hasKey(key.id)).toBe(false);
      await expectCode(mgr.encryptEnvelope('x', 'task:1:args'), 'LOCKED');
      await expectCode(mgr.decryptEnvelope(env, 'task:1:args'), 'LOCKED');
      await expectCode(mgr.deriveDataKey(), 'LOCKED');

      await mgr.unlock({ password: PASS, creator: CREATOR });
      expect(await mgr.decryptEnvelope(env, 'task:1:args')).toBe('secret');
    });

    it('re-derives keys lazily after a reload and dedupes concurrent derivations', async () => {
      const { mgr, storage, key } = await unlocked();
      const envs = await Promise.all(
        Array.from({ length: 10 }, (_, i) => mgr.encryptEnvelope(`m${i}`, `task:${i}:args`)),
      );

      const { subtle, spies } = spySubtle();
      const reloaded = makeManager(storage, { crypto: subtle });
      expect(reloaded.hasKey(key.id)).toBe(false);
      await reloaded.unlock({ password: PASS, creator: CREATOR });
      const derivesAfterUnlock = spies.deriveKey.mock.calls.length;

      const out = await Promise.all(envs.map((e, i) => reloaded.decryptEnvelope(e, `task:${i}:args`)));
      expect(out).toEqual(envs.map((_, i) => `m${i}`));
      expect(spies.deriveKey.mock.calls.length - derivesAfterUnlock).toBe(1);
    });

    it('clearStorage removes master config and metadata', async () => {
      const { mgr, storage } = await unlocked();
      mgr.clearStorage();
      expect(storage.store.size).toBe(0);
      expect(mgr.hasMasterConfig()).toBe(false);
      expect(mgr.listKeys()).toEqual([]);
    });
  });

  // ── rotation ────────────────────────────────────────────────────────────

  describe('rotation', () => {
    it('new data uses the new key; old envelopes still decrypt by kid', async () => {
      const { mgr, key } = await unlocked();
      const oldEnv = await mgr.encryptEnvelope('before', 'task:1:args');
      const { newKeyId } = await mgr.rotateKey(key.id);

      const newEnv = await mgr.encryptEnvelope('after', 'task:1:args');
      expect(newEnv.kid).toBe(newKeyId);
      expect(mgr.getKeyMetadata(newKeyId)?.derivation).toBeDefined();
      expect(await mgr.decryptEnvelope(oldEnv, 'task:1:args')).toBe('before');
      expect(await mgr.decryptEnvelope(newEnv, 'task:1:args')).toBe('after');
    });

    it('rotated keys cannot encrypt new data', async () => {
      const { mgr, key } = await unlocked();
      await mgr.rotateKey(key.id);
      await expectCode(mgr.encryptEnvelope('x', 'ctx', key.id), 'KEY_NOT_ACTIVE');
      expect(() => mgr.setActiveKeyId(key.id)).toThrow(expect.objectContaining({ code: 'KEY_NOT_ACTIVE' }));
    });

    it('rotated keys survive reload and remain decryptable after unlock', async () => {
      const { mgr, storage, key } = await unlocked();
      const oldEnv = await mgr.encryptEnvelope('before', 'task:1:args');
      await mgr.rotateKey(key.id);
      const reloaded = makeManager(storage);
      await reloaded.unlock({ password: PASS, creator: CREATOR });
      expect(await reloaded.decryptEnvelope(oldEnv, 'task:1:args')).toBe('before');
    });

    it('rotating a derived key while locked fails with LOCKED', async () => {
      const { mgr, key } = await unlocked();
      mgr.lock();
      await expectCode(mgr.rotateKey(key.id), 'LOCKED');
    });

    it('pipeline.reEncryptEnvelope migrates data to the new key', async () => {
      const { mgr, key } = await unlocked();
      const pipeline = new EncryptionPipeline({ manager: mgr, enableErrorTracking: false });
      const oldEnv = await mgr.encryptEnvelope('migrate-me', 'task:1:args');
      const { newKeyId } = await mgr.rotateKey(key.id);
      const result = await pipeline.reEncryptEnvelope(oldEnv, 'task:1:args');
      expect(result.success).toBe(true);
      expect(result.data?.kid).toBe(newKeyId);
      expect(await mgr.decryptEnvelope(result.data!, 'task:1:args')).toBe('migrate-me');

      const bad = await pipeline.reEncryptEnvelope(oldEnv, 'task:2:args');
      expect(bad.success).toBe(false);
    });

    it('revoked keys can neither decrypt nor be re-derived', async () => {
      const { mgr, key } = await unlocked();
      const env = await mgr.encryptEnvelope('x', 'ctx');
      mgr.revokeKey(key.id);
      await expectCode(mgr.decryptEnvelope(env, 'ctx'), 'KEY_REVOKED');
      await expectCode(mgr.rotateKey(key.id), 'KEY_REVOKED');
    });

    it('enforces a per-key message limit that forces rotation', async () => {
      const storage = new MemStorage();
      const mgr = makeManager(storage, { maxMessagesPerKey: 2 });
      await mgr.unlock({ password: PASS, iterations: ITER });
      const key = await mgr.deriveDataKey();
      await mgr.encryptEnvelope('1', 'ctx');
      await mgr.encrypt('2');
      expect(mgr.getMessageCount(key.id)).toBe(2);
      await expectCode(mgr.encryptEnvelope('3', 'ctx'), 'KEY_USAGE_LIMIT');
      await mgr.rotateKey(key.id);
      await expect(mgr.encryptEnvelope('3', 'ctx')).resolves.toBeDefined();
    });
  });

  // ── legacy API hardening ────────────────────────────────────────────────

  describe('legacy encrypt/decrypt', () => {
    it('supports optional AAD and rejects a mismatched AAD', async () => {
      const mgr = makeManager();
      await mgr.generateKey();
      const payload = await mgr.encrypt('legacy', undefined, { additionalData: 'task:1' });
      expect(await mgr.decrypt(payload, { additionalData: 'task:1' })).toBe('legacy');
      await expectCode(mgr.decrypt(payload, { additionalData: 'task:2' }), 'DECRYPT_FAILED');
      await expectCode(mgr.decrypt(payload), 'DECRYPT_FAILED');
    });

    it('refuses to encrypt with a wrap-purpose key', async () => {
      const mgr = makeManager();
      const wrap = await mgr.generateKey('wrap');
      await expectCode(mgr.encrypt('x', wrap.id), 'KEY_PURPOSE_MISMATCH');
    });

    it('legacy deriveKey is non-extractable and supports creator salt', async () => {
      const mgr = makeManager();
      const meta = await mgr.deriveKey({ password: PASS, creator: CREATOR, iterations: ITER });
      await expectCode(mgr.exportKey(meta.id), 'KEY_NOT_EXTRACTABLE');
      await expectCode(mgr.deriveKey({ password: '' }), 'INVALID_PASSPHRASE');
    });
  });

  // ── pipeline ────────────────────────────────────────────────────────────

  describe('pipeline', () => {
    it('does not retry deterministic auth failures', async () => {
      const { subtle, spies } = spySubtle();
      const mgr = makeManager(new MemStorage(), { crypto: subtle });
      await mgr.generateKey();
      const pipeline = new EncryptionPipeline({ manager: mgr, maxRetries: 3, enableErrorTracking: false });
      const payload = (await pipeline.safeEncrypt('x')).data!;
      spies.decrypt.mockClear();
      const res = await pipeline.safeDecrypt({ ...payload, ciphertext: flipByte(payload.ciphertext) });
      expect(res.success).toBe(false);
      expect(spies.decrypt).toHaveBeenCalledTimes(1);
    });

    it('bootstrap reuses the existing derived key on a returning device', async () => {
      const storage = new MemStorage();
      const first = new EncryptionPipeline({ manager: makeManager(storage), enableErrorTracking: false });
      const r1 = await first.bootstrap({ password: PASS, creator: CREATOR, iterations: ITER });
      const second = new EncryptionPipeline({ manager: makeManager(storage), enableErrorTracking: false });
      const r2 = await second.bootstrap({ password: PASS, creator: CREATOR });
      expect(r2.data).toBe(r1.data);
      const r3 = await new EncryptionPipeline({ manager: makeManager(storage), enableErrorTracking: false })
        .bootstrap({ password: 'wrong', creator: CREATOR });
      expect(r3.success).toBe(false);
      expect(r3.error).toMatch(/incorrect passphrase/i);
    });

    it('error tracking never logs plaintext', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { mgr } = await unlocked();
      const pipeline = new EncryptionPipeline({ manager: mgr, enableErrorTracking: true });
      mgr.lock();
      await pipeline.safeEncrypt('top-secret-arg');
      const logged = spy.mock.calls.flat().map(String).join(' ');
      expect(logged).not.toContain('top-secret-arg');
      expect(logged).toContain('LOCKED');
      spy.mockRestore();
    });
  });
});
