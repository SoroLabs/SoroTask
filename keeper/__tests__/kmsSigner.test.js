const crypto = require('crypto');
const {
  KMSSigner,
  AwsKmsSigner,
  GcpKmsSigner,
  createKMSSigner,
  AwsKmsAdapter,
  GcpKmsAdapter,
  assertNoPlaintextKeys,
  crc32c,
} = require('../src/signers/kmsSigner');

const DER_PUBLIC_KEY = Buffer.from(
  'MCowBQYDK2VwAyEADROslPKMgTnpPenJHCMVWg7tu9o3InVpoeLt/jZw9Ks=',
  'base64',
);
const TEST_DIGEST = crypto.createHash('sha256').update('sorotask').digest();
const TEST_SIGNATURE = Buffer.from('c2lnbmF0dXJlLWJ5dGVz');

function makeAuditLogger() {
  return { record: jest.fn() };
}

function makeAwsClient() {
  return {
    send: jest.fn(async (command) => {
      const input = command.input || {};
      if (command.constructor && command.constructor.name === 'GetPublicKeyCommand') {
        return {
          PublicKey: new Uint8Array(DER_PUBLIC_KEY),
          KeySpec: 'ED25519',
          $metadata: { requestId: 'aws-get-public-key' },
        };
      }
      if (input.Message) {
        return {
          Signature: new Uint8Array(TEST_SIGNATURE),
          $metadata: { requestId: 'aws-sign-request' },
        };
      }
      return { PublicKey: new Uint8Array(DER_PUBLIC_KEY) };
    }),
  };
}

function makeGcpClient() {
  const name = 'projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1';
  return {
    getCryptoKey: jest.fn(async () => [{
      name: name.split('/cryptoKeyVersions/')[0],
      primary: { name, state: 'ENABLED' },
    }]),
    getPublicKey: jest.fn(async () => [{
      pem: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',
      algorithm: 'EC_SIGN_P256_SHA256',
    }]),
    asymmetricSign: jest.fn(async ({ digest }) => [{
      name,
      signature: new Uint8Array(TEST_SIGNATURE),
      signatureCrc32c: { value: crc32c(TEST_SIGNATURE) },
      verifiedDigestCrc32c: true,
      requestId: 'gcp-sign-request',
      digest,
    }]),
  };
}

describe('KMS signer adapters', () => {
  test('normalizes provider aliases and rejects unknown providers', () => {
    expect(new KMSSigner({ provider: 'aws', keyId: 'k', client: makeAwsClient() }).provider).toBe('aws-kms');
    expect(new KMSSigner({ provider: 'google-kms', keyId: 'k', client: makeGcpClient() }).provider).toBe('gcp-kms');
    expect(() => new KMSSigner({ provider: 'pkcs11', keyId: 'k' })).toThrow(/Unsupported KMS provider/);
  });

  test('AWS adapter signs with RAW/ED25519 and never sees a private key', async () => {
    const client = makeAwsClient();
    const audit = makeAuditLogger();
    const signer = new AwsKmsSigner({ keyId: 'alias/keeper', client, auditLogger: audit });

    const publicKey = await signer.getPublicKey();
    expect(Buffer.isBuffer(publicKey)).toBe(true);
    expect(publicKey.publicPem).toContain('BEGIN PUBLIC KEY');
    expect(publicKey.active).toBe(true);

    const signature = await signer.sign(TEST_DIGEST);
    expect(Buffer.isBuffer(signature)).toBe(true);
    expect(signature.equals(TEST_SIGNATURE)).toBe(true);

    const signCommand = client.send.mock.calls.map(([c]) => c).find((c) => c.input && c.input.Message);
    expect(signCommand.input.MessageType).toBe('RAW');
    expect(signCommand.input.SigningAlgorithm).toBe('ED25519');
    expect(signCommand.input.KeyId).toBe('alias/keeper');

    const event = audit.record.mock.calls.find(([name]) => name === 'signer.kms.sign');
    expect(event).toBeDefined();
    expect(event[1].success).toBe(true);
    expect(event[1].cloudTrail.eventSource).toBe('kms.amazonaws.com');
    expect(event[1].cloudTrail.eventName).toBe('Sign');
    expect(event[1].requestId).toBe('aws-sign-request');
    expect(event[1].withinBudget).toBe(true);
    expect(event[1].digestSha256).toBe(crypto.createHash('sha256').update(TEST_DIGEST).digest('hex'));
  });

  test('GCP adapter verifies integrity fields and audits Cloud Audit Logs metadata', async () => {
    const client = makeGcpClient();
    const audit = makeAuditLogger();
    const signer = new GcpKmsSigner({
      keyId: 'k',
      projectId: 'p',
      locationId: 'global',
      keyRingId: 'r',
      client,
      auditLogger: audit,
    });

    const signature = await signer.sign(TEST_DIGEST);
    expect(signature.equals(TEST_SIGNATURE)).toBe(true);
    expect(client.asymmetricSign).toHaveBeenCalledTimes(1);
    expect(client.asymmetricSign.mock.calls[0][0].digestCrc32c.value).toBe(crc32c(TEST_DIGEST));

    const event = audit.record.mock.calls.find(([name]) => name === 'signer.kms.sign');
    expect(event[1].cloudAuditLog.methodName).toBe('AsymmetricSign');
    expect(event[1].cloudAuditLog.resourceName).toContain('/cryptoKeyVersions/1');
  });

  test('GCP adapter rejects corrupted signatures', async () => {
    const client = makeGcpClient();
    client.asymmetricSign = jest.fn(async () => [{
      name: 'projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',
      signature: new Uint8Array(TEST_SIGNATURE),
      signatureCrc32c: { value: 0 },
      verifiedDigestCrc32c: true,
    }]);
    const signer = new GcpKmsSigner({ keyId: 'k', projectId: 'p', keyRingId: 'r', client });
    await expect(signer.sign(TEST_DIGEST)).rejects.toThrow(/CRC32C/);
  });

  test('CRC32C implementation matches the published check vector', () => {
    expect(crc32c(Buffer.from('123456789'))).toBe(0xe3069283);
  });

  test('rejects plaintext key material at every entry point', () => {
    expect(() => new KMSSigner({ provider: 'aws', keyId: 'k', privateKey: 'SXXX' }))
      .toThrow(/plaintext key material/);
    expect(() => assertNoPlaintextKeys({ secretKey: 'abc' })).toThrow();
    const signer = createKMSSigner({ provider: 'aws', keyId: 'k', client: makeAwsClient() });
    expect(() => signer.sign(TEST_DIGEST, { seed: 'abc' })).toThrow(/plaintext key material/);
  });

  test('audits failures as well as successes', async () => {
    const audit = makeAuditLogger();
    const client = { send: jest.fn(async () => { throw new Error('KMS unavailable'); }) };
    const signer = new KMSSigner({ provider: 'aws', keyId: 'k', client, auditLogger: audit });
    await expect(signer.sign(TEST_DIGEST)).rejects.toThrow('KMS unavailable');

    const event = audit.record.mock.calls.find(([name]) => name === 'signer.kms.sign.error');
    expect(event).toBeDefined();
    expect(event[1].success).toBe(false);
    expect(event[1].code).toBe('KMS_SIGN_FAILED');
    expect(signer.getStats().signFailure).toBe(1);
  });

  test('enforces the 50ms latency budget in strict mode and records breaches', async () => {
    const audit = makeAuditLogger();
    const client = {
      send: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { Signature: new Uint8Array(TEST_SIGNATURE), $metadata: { requestId: 'slow' } };
      }),
    };
    const signer = new KMSSigner({
      provider: 'aws',
      keyId: 'k',
      client,
      latencyBudgetMs: 5,
      enforceLatencyBudget: true,
      auditLogger: audit,
    });

    await expect(signer.sign(TEST_DIGEST)).rejects.toMatchObject({
      code: 'KMS_LATENCY_BUDGET_EXCEEDED',
    });
    expect(signer.getStats().budgetExceeded).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      'signer.kms.sign',
      expect.objectContaining({ withinBudget: false }),
    );
  });

  test('times out slow KMS calls instead of blocking the executor', async () => {
    const client = { send: jest.fn(() => new Promise(() => {})) };
    const signer = new KMSSigner({
      provider: 'aws',
      keyId: 'k',
      client,
      timeoutMs: 15,
    });
    await expect(signer.sign(TEST_DIGEST)).rejects.toThrow(/timed out/);
    expect(signer.getStats().timeoutTotal).toBe(1);
  });

  test('sequential signatures stay inside the 50ms latency budget', async () => {
    const client = makeAwsClient();
    const signer = new KMSSigner({ provider: 'aws', keyId: 'k', client });
    for (let i = 0; i < 10; i++) await signer.sign(TEST_DIGEST);
    expect(signer.getStats().maxLatencyMs).toBeLessThan(50);
    expect(signer.getStats().budgetExceeded).toBe(0);
  });

  test('signMany keeps signatures correlated with their digests', async () => {
    const client = makeAwsClient();
    const signer = new KMSSigner({ provider: 'aws', keyId: 'k', client });
    const digests = Array.from({ length: 20 }, (_, i) =>
      crypto.createHash('sha256').update(`task-${i}`).digest());
    const signatures = await signer.signMany(digests);
    expect(signatures).toHaveLength(20);
    expect(signatures.every((s) => s.equals(TEST_SIGNATURE))).toBe(true);
    expect(signer.getStats().signSuccess).toBe(20);
  });

  test('custom adapters are supported for on-prem HSM gateways', async () => {
    const adapter = {
      provider: 'aws-kms',
      cloudAuditMetadata: () => ({ auditSource: 'local' }),
      sign: jest.fn(async () => ({ signature: TEST_SIGNATURE })),
      getPublicKey: jest.fn(async () => ({ publicPem: 'pem', keyId: 'k' })),
    };
    const signer = new KMSSigner({ provider: 'aws', keyId: 'k', adapter });
    expect((await signer.sign(TEST_DIGEST)).equals(TEST_SIGNATURE)).toBe(true);
    expect(adapter.sign).toHaveBeenCalledTimes(1);
  });
});

describe('KMS signer stress', () => {
  test('handles 250 concurrent signatures within budget with complete audits', async () => {
    const audit = { record: jest.fn() };
    const client = makeAwsClient();
    const signer = new KMSSigner({
      provider: 'aws',
      keyId: 'alias/keeper',
      client,
      auditLogger: audit,
      latencyBudgetMs: 50,
    });

    const digests = Array.from({ length: 250 }, (_, i) =>
      crypto.createHash('sha256').update(`stress-${i}`).digest());
    const started = Date.now();
    const results = await Promise.all(digests.map((d) => signer.sign(d)));
    const elapsed = Date.now() - started;

    expect(results).toHaveLength(250);
    expect(results.every((r) => Buffer.isBuffer(r) && r.equals(TEST_SIGNATURE))).toBe(true);
    expect(elapsed).toBeLessThan(2000);
    expect(signer.getStats().signFailure).toBe(0);
    expect(signer.getStats().count).toBe(250);
    expect(audit.record.mock.calls.filter(([name]) => name === 'signer.kms.sign')).toHaveLength(250);
  });
});

describe('KMS signer factory exports', () => {
  test('exposes AWS and GCP adapters explicitly', () => {
    expect(new AwsKmsAdapter({ keyId: 'k' }).provider).toBe('aws-kms');
    expect(new GcpKmsAdapter({ keyId: 'k' }).provider).toBe('gcp-kms');
  });
});
