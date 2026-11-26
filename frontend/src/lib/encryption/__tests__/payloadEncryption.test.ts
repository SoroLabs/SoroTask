import { EncryptionKeyManager } from '../EncryptionKeyManager';
import {
  assertEncryptedFields,
  decryptTaskArguments,
  decryptWebhookConfig,
  encryptTaskArguments,
  encryptWebhookConfig,
  isEncryptedEnvelope,
  parseEnvelope,
  serializeEnvelope,
  taskFieldContext,
} from '../payloadEncryption';
import { EncryptionError } from '../types';

class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
}

function realSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle !== 'undefined') return globalThis.crypto.subtle;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto').webcrypto.subtle as SubtleCrypto;
}

beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { webcrypto } = require('crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

let mgr: EncryptionKeyManager;
beforeEach(async () => {
  mgr = new EncryptionKeyManager({ storage: new MemStorage(), crypto: realSubtle() });
  await mgr.unlock({ password: 'pw', creator: 'GCREATOR', iterations: 1000 });
  await mgr.deriveDataKey('data-key');
});

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(EncryptionError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('task argument encryption', () => {
  const args = { recipient: 'GPRIVATERECIPIENT', amount: '1000000', memo: 'salary-march' };

  it('round-trips arguments', async () => {
    const enc = await encryptTaskArguments(mgr, 'task-42', args);
    expect(enc.taskId).toBe('task-42');
    expect(await decryptTaskArguments(mgr, enc)).toEqual(args);
  });

  it('transmits no plaintext argument values', async () => {
    const wire = JSON.stringify(await encryptTaskArguments(mgr, 'task-42', args));
    for (const v of Object.values(args)) expect(wire).not.toContain(v);
    for (const k of Object.keys(args)) expect(wire).not.toContain(k);
  });

  it('is bound to its task id (cannot be replayed on another task)', async () => {
    const enc = await encryptTaskArguments(mgr, 'task-42', args);
    await expectCode(decryptTaskArguments(mgr, { ...enc, taskId: 'task-43' }), 'DECRYPT_FAILED');
  });

  it('rejects non-serializable arguments', async () => {
    await expectCode(encryptTaskArguments(mgr, 't', undefined), 'INVALID_PAYLOAD');
    await expectCode(encryptTaskArguments(mgr, 't', { n: BigInt(1) }), 'INVALID_PAYLOAD');
  });

  it('requires a task id', async () => {
    await expectCode(encryptTaskArguments(mgr, '  ', args), 'CONTEXT_REQUIRED');
  });

  it('rejects decrypted data that is not JSON', async () => {
    const env = await mgr.encryptEnvelope('not json', taskFieldContext('t', 'args'));
    await expectCode(decryptTaskArguments(mgr, { taskId: 't', encryptedArgs: env }), 'INVALID_PAYLOAD');
  });
});

describe('webhook encryption', () => {
  const config = {
    url: 'https://hooks.example.com/T000/B000/secret-path',
    secret: 'whsec_supersecret',
    headers: { Authorization: 'Bearer token-abc' },
  };

  it('round-trips url, secret and headers', async () => {
    const enc = await encryptWebhookConfig(mgr, 'task-1', config);
    expect(await decryptWebhookConfig(mgr, enc)).toEqual(config);
  });

  it('only encrypts the fields provided', async () => {
    const enc = await encryptWebhookConfig(mgr, 'task-1', { url: config.url });
    expect(enc.secret).toBeUndefined();
    expect(enc.headers).toBeUndefined();
    expect(await decryptWebhookConfig(mgr, enc)).toEqual({ url: config.url });
  });

  it('transmits no plaintext', async () => {
    const wire = JSON.stringify(await encryptWebhookConfig(mgr, 'task-1', config));
    expect(wire).not.toContain('hooks.example.com');
    expect(wire).not.toContain('whsec_supersecret');
    expect(wire).not.toContain('token-abc');
    expect(wire).not.toContain('Authorization');
  });

  it('binds each value to its field (url/secret cannot be swapped)', async () => {
    const enc = await encryptWebhookConfig(mgr, 'task-1', config);
    await expectCode(decryptWebhookConfig(mgr, { ...enc, url: enc.secret! }), 'DECRYPT_FAILED');
    await expectCode(decryptWebhookConfig(mgr, { ...enc, taskId: 'task-2' }), 'DECRYPT_FAILED');
  });

  it('validates the URL without echoing it', async () => {
    const bad = 'not a url with secret-token';
    await expect(encryptWebhookConfig(mgr, 't', { url: bad })).rejects.toMatchObject({ code: 'INVALID_WEBHOOK_URL' });
    try {
      await encryptWebhookConfig(mgr, 't', { url: bad });
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-token');
    }
    await expectCode(encryptWebhookConfig(mgr, 't', { url: 'ftp://example.com' }), 'INVALID_WEBHOOK_URL');
  });

  it('rejects decrypted headers that are not JSON', async () => {
    const enc = await encryptWebhookConfig(mgr, 't', { url: config.url });
    const headers = await mgr.encryptEnvelope('nope', taskFieldContext('t', 'webhook.headers'));
    await expectCode(decryptWebhookConfig(mgr, { ...enc, headers }), 'INVALID_PAYLOAD');
  });
});

describe('transport guard & serialization', () => {
  it('assertEncryptedFields passes for envelopes and skips absent optional fields', async () => {
    const body = {
      args: await encryptTaskArguments(mgr, 't', { a: 1 }),
      webhook: await encryptWebhookConfig(mgr, 't', { url: 'https://x.test' }),
    };
    expect(() =>
      assertEncryptedFields(body, ['args.encryptedArgs', 'webhook.url', 'webhook.secret']),
    ).not.toThrow();
  });

  it('assertEncryptedFields names the plaintext field without leaking its value', () => {
    const body = { webhook: { url: 'https://plaintext.example/secret' } };
    expect(() => assertEncryptedFields(body, ['webhook.url'])).toThrow(
      expect.objectContaining({ code: 'PLAINTEXT_FIELD' }),
    );
    try {
      assertEncryptedFields(body, ['webhook.url']);
    } catch (err) {
      expect((err as Error).message).toContain('webhook.url');
      expect((err as Error).message).not.toContain('plaintext.example');
    }
    expect(() => assertEncryptedFields({ a: 'x' }, ['a.b.c'])).not.toThrow();
  });

  it('serializes and parses envelopes strictly', async () => {
    const env = await mgr.encryptEnvelope('v', 'ctx');
    const s = serializeEnvelope(env);
    expect(parseEnvelope(s)).toEqual(env);
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(isEncryptedEnvelope({ ...env, plaintext: 'v' })).toBe(false);
    expect(() => parseEnvelope('{oops')).toThrow(expect.objectContaining({ code: 'INVALID_ENVELOPE' }));
  });

  it('taskFieldContext validates and escapes', () => {
    expect(taskFieldContext('a:b', 'args')).toBe('task:a%3Ab:args');
    expect(() => taskFieldContext('t', '')).toThrow(EncryptionError);
  });
});
