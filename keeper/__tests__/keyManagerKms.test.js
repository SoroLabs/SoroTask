const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { KeyManager } = require('../src/keyManager');
const { MockHSMProvider } = require('../src/hsm/mockProvider');
const { buildSecurityStack } = require('../src/keeperSecurity');

const TEST_PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\ntest-public-key\n-----END PUBLIC KEY-----';
const TEST_SIGNATURE = Buffer.from('kms-signature');

function makeKmsSigner(overrides = {}) {
  return {
    provider: 'aws-kms',
    keyId: 'kms-key-1',
    keyIds: ['kms-key-1'],
    getPublicKey: jest.fn(async () => ({
      publicPem: TEST_PUBLIC_PEM,
      algorithm: 'ed25519',
      active: true,
    })),
    sign: jest.fn(async () => TEST_SIGNATURE),
    ...overrides,
  };
}

function makeManager(opts = {}) {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sorotask-km-'));
  const manager = new KeyManager({
    hsm: new MockHSMProvider(),
    auditLogger: { record: jest.fn() },
    storageDir,
    ...opts,
  });
  return { manager, storageDir };
}

function readMeta(storageDir) {
  return JSON.parse(fs.readFileSync(path.join(storageDir, 'keys.json'), 'utf8'));
}

describe('KeyManager cloud KMS integration', () => {
  test('registers a KMS key with public metadata only', async () => {
    const { manager, storageDir } = makeManager();
    const entry = await manager.registerKmsKey({
      keyId: 'kms-key-1',
      provider: 'aws-kms',
      signer: makeKmsSigner(),
    });

    expect(entry.provider).toBe('aws-kms');
    expect(entry.fingerprint).toBe(crypto.createHash('sha256').update(TEST_PUBLIC_PEM).digest('hex'));
    expect(entry.privateKey).toBeUndefined();

    const persisted = readMeta(storageDir)['kms-key-1'];
    expect(persisted.publicPem).toBe(TEST_PUBLIC_PEM);
    expect(persisted.provider).toBe('aws-kms');
    expect(Object.keys(persisted).some((k) => /private|secret|seed/i.test(k))).toBe(false);
    expect(manager.verifyNoPlaintextSecrets()).toEqual([]);
    expect(manager.assertNoPlaintextSecrets()).toBe(true);
  });

  test('delegates signing to the KMS signer and audits the operation', async () => {
    const audit = { record: jest.fn() };
    const signer = makeKmsSigner();
    const { manager } = makeManager({ auditLogger: audit });
    await manager.registerKmsKey({ keyId: 'kms-key-1', provider: 'aws-kms', signer });

    const digest = crypto.createHash('sha256').update('tx').digest();
    const signature = await manager.sign('kms-key-1', digest);
    expect(signature.equals(TEST_SIGNATURE)).toBe(true);
    expect(signer.sign).toHaveBeenCalledWith(digest, { keyId: 'kms-key-1' });
    expect(audit.record.mock.calls.map(([name]) => name)).toContain('key.sign');
  });

  test('getPublicKey and listKeys expose registered KMS keys', async () => {
    const { manager } = makeManager();
    await manager.registerKmsKey({
      keyId: 'kms-key-1',
      provider: 'gcp-kms',
      signer: makeKmsSigner({ provider: 'gcp-kms' }),
    });

    const publicKey = await manager.getPublicKey('kms-key-1');
    expect(publicKey.publicPem).toBe(TEST_PUBLIC_PEM);
    const listed = await manager.listKeys();
    expect(listed.find((key) => key.keyId === 'kms-key-1').meta.provider).toBe('gcp-kms');
  });

  test('createKey refuses plaintext material in options or provider responses', async () => {
    const { manager } = makeManager();
    await expect(manager.createKey({ keyId: 'bad', privateKey: 'SSECRET' }))
      .rejects.toThrow(/plaintext key material/);

    const leakingHsm = {
      generateKey: jest.fn(async () => ({
        keyId: 'leak',
        publicPem: TEST_PUBLIC_PEM,
        privateKey: 'MUST-NOT-BE-STORED',
      })),
    };
    const leaking = new KeyManager({
      hsm: leakingHsm,
      storageDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sorotask-km-leak-')),
    });
    await expect(leaking.createKey({ keyId: 'leak' })).rejects.toThrow(/plaintext key material/);
  });

  test('metadata persistence strips any legacy secret fields', () => {
    const { manager, storageDir } = makeManager();
    manager.keys.legacy = {
      keyId: 'legacy',
      publicPem: TEST_PUBLIC_PEM,
      privateKey: 'old-plaintext-key',
      active: true,
    };
    manager._persistMeta();
    manager.keys = manager._loadMeta();

    expect(manager.keys.legacy.privateKey).toBeUndefined();
    expect(fs.readFileSync(path.join(storageDir, 'keys.json'), 'utf8'))
      .not.toContain('old-plaintext-key');
    expect(manager.verifyNoPlaintextSecrets()).toEqual([]);
  });

  test('security stack accepts pre-configured cloud KMS signers', () => {
    const stack = buildSecurityStack({
      storageDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sorotask-km-stack-')),
      kmsSigners: { 'kms-key-1': makeKmsSigner() },
    });
    expect(stack.keyManager.isKmsKey('kms-key-1')).toBe(true);
  });
});
