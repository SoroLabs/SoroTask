const { GcpKmsProvider } = require('../src/hsm/gcpKmsProvider');

/**
 * GCP Cloud KMS provider (Issue #1053).
 *
 * The client is faked rather than mocked at the module level so the tests
 * exercise the provider's real behaviour — version resolution, CRC32C integrity
 * checks, and the resource-name handling that differs from the AWS adapter.
 */

const PROJECT = 'soro-proj';
const LOCATION = 'us-central1';
const RING = 'keeper-ring';
const KEY = 'keeper-key';

const CRYPTO_KEY = `projects/${PROJECT}/locations/${LOCATION}/keyRings/${RING}/cryptoKeys/${KEY}`;
const VERSION_1 = `${CRYPTO_KEY}/cryptoKeyVersions/1`;
const VERSION_2 = `${CRYPTO_KEY}/cryptoKeyVersions/2`;

/** Minimal stand-in for KeyManagementServiceClient. */
function fakeClient(overrides = {}) {
  return {
    calls: [],
    keyRingPath: (p, l, r) => `projects/${p}/locations/${l}/keyRings/${r}`,
    cryptoKeyPath: (p, l, r, k) =>
      `projects/${p}/locations/${l}/keyRings/${r}/cryptoKeys/${k}`,
    getCryptoKey: jest.fn(async () => [{ primary: { name: VERSION_1, state: 'ENABLED' } }]),
    listCryptoKeyVersions: jest.fn(async () => [[{ name: VERSION_1, state: 'ENABLED' }]]),
    getPublicKey: jest.fn(async () => [{ pem: '-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----', algorithm: 'EC_SIGN_P256_SHA256' }]),
    asymmetricSign: jest.fn(async () => [{ name: VERSION_1, signature: Buffer.from('sig') }]),
    createCryptoKey: jest.fn(async () => [{ name: CRYPTO_KEY }]),
    createCryptoKeyVersion: jest.fn(async () => [{ name: VERSION_2 }]),
    updateCryptoKeyPrimaryVersion: jest.fn(async () => [{}]),
    updateCryptoKeyVersion: jest.fn(async () => [{}]),
    listCryptoKeys: jest.fn(async () => [[]]),
    ...overrides,
  };
}

function makeProvider(client = fakeClient()) {
  const provider = new GcpKmsProvider({
    projectId: PROJECT,
    locationId: LOCATION,
    keyRingId: RING,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  provider._client = client;
  return { provider, client };
}

describe('GcpKmsProvider configuration', () => {
  it('defaults the location to global', () => {
    const provider = new GcpKmsProvider({ projectId: PROJECT, keyRingId: RING });
    expect(provider.locationId).toBe('global');
  });

  it('defaults to an asymmetric signing algorithm Cloud KMS actually offers', () => {
    const provider = new GcpKmsProvider({ projectId: PROJECT, keyRingId: RING });
    // Cloud KMS has no Ed25519 signing algorithm.
    expect(provider.defaultAlgorithm).toBe('EC_SIGN_P256_SHA256');
  });

  it('refuses to build a path without project and key ring', async () => {
    const provider = new GcpKmsProvider({});
    provider._client = fakeClient();

    await expect(provider.getPublicKey(KEY)).rejects.toThrow(/projectId and keyRingId/);
  });
});

describe('CRC32C', () => {
  it('matches the known Castagnoli checksum for "abc"', () => {
    const { provider } = makeProvider();
    // 0x364B3FB7 is the published CRC32C of "abc".
    expect(provider._crc32c(Buffer.from('abc'))).toBe(0x364b3fb7);
  });

  it('is zero for empty input', () => {
    const { provider } = makeProvider();
    expect(provider._crc32c(Buffer.alloc(0))).toBe(0);
  });

  it('changes when a single byte changes', () => {
    const { provider } = makeProvider();
    expect(provider._crc32c(Buffer.from('abc'))).not.toBe(provider._crc32c(Buffer.from('abd')));
  });
});

describe('version resolution', () => {
  it('uses a fully-qualified version path untouched', async () => {
    const { provider, client } = makeProvider();
    await provider.getPublicKey(VERSION_2);

    expect(client.getCryptoKey).not.toHaveBeenCalled();
    expect(client.getPublicKey).toHaveBeenCalledWith({ name: VERSION_2 });
  });

  it('resolves a bare key id to its primary version', async () => {
    const { provider, client } = makeProvider();
    await provider.getPublicKey(KEY);

    expect(client.getPublicKey).toHaveBeenCalledWith({ name: VERSION_1 });
  });

  it('falls back to the newest enabled version when the primary is disabled', async () => {
    const client = fakeClient({
      getCryptoKey: jest.fn(async () => [{ primary: { name: VERSION_1, state: 'DISABLED' } }]),
      listCryptoKeyVersions: jest.fn(async () => [[
        { name: VERSION_1, state: 'DESTROYED' },
        { name: VERSION_2, state: 'ENABLED' },
      ]]),
    });
    const { provider } = makeProvider(client);

    await provider.getPublicKey(KEY);

    // A key mid-rotation must still sign rather than fail outright.
    expect(client.getPublicKey).toHaveBeenCalledWith({ name: VERSION_2 });
  });

  it('throws when no version is enabled', async () => {
    const client = fakeClient({
      getCryptoKey: jest.fn(async () => [{ primary: { name: VERSION_1, state: 'DISABLED' } }]),
      listCryptoKeyVersions: jest.fn(async () => [[{ name: VERSION_1, state: 'DISABLED' }]]),
    });
    const { provider } = makeProvider(client);

    await expect(provider.getPublicKey(KEY)).rejects.toThrow(/No enabled Cloud KMS key version/);
  });
});

describe('sign', () => {
  it('sends the digest with its CRC32C and returns the signature', async () => {
    const { provider, client } = makeProvider();
    const digest = Buffer.from('0123456789abcdef');

    const signature = await provider.sign(KEY, digest);

    expect(signature).toEqual(Buffer.from('sig'));
    const request = client.asymmetricSign.mock.calls[0][0];
    expect(request.name).toBe(VERSION_1);
    expect(request.digest.sha256).toEqual(digest);
    expect(request.digestCrc32c.value).toBe(provider._crc32c(digest));
  });

  it('rejects when Cloud KMS reports the digest arrived corrupted', async () => {
    const client = fakeClient({
      asymmetricSign: jest.fn(async () => [
        { name: VERSION_1, signature: Buffer.from('sig'), verifiedDigestCrc32c: false },
      ]),
    });
    const { provider } = makeProvider(client);

    await expect(provider.sign(KEY, Buffer.from('d'))).rejects.toThrow(/digest CRC32C mismatch/);
  });

  it('rejects a signature whose CRC32C does not match', async () => {
    const client = fakeClient({
      asymmetricSign: jest.fn(async () => [
        {
          name: VERSION_1,
          signature: Buffer.from('sig'),
          verifiedDigestCrc32c: true,
          signatureCrc32c: { value: 12345 },
        },
      ]),
    });
    const { provider } = makeProvider(client);

    // A corrupted signature would otherwise be rejected by the network, far
    // from where it actually broke.
    await expect(provider.sign(KEY, Buffer.from('d'))).rejects.toThrow(/signature failed CRC32C/);
  });

  it('accepts a signature whose CRC32C matches', async () => {
    const signature = Buffer.from('good-signature');
    const probe = new GcpKmsProvider({ projectId: PROJECT, keyRingId: RING });
    const client = fakeClient({
      asymmetricSign: jest.fn(async () => [
        {
          name: VERSION_1,
          signature,
          verifiedDigestCrc32c: true,
          signatureCrc32c: { value: probe._crc32c(signature) },
        },
      ]),
    });
    const { provider } = makeProvider(client);

    await expect(provider.sign(KEY, Buffer.from('d'))).resolves.toEqual(signature);
  });

  it('rejects a response signed by an unexpected key version', async () => {
    const client = fakeClient({
      asymmetricSign: jest.fn(async () => [{ name: VERSION_2, signature: Buffer.from('sig') }]),
    });
    const { provider } = makeProvider(client);

    await expect(provider.sign(VERSION_1, Buffer.from('d'))).rejects.toThrow(
      /unexpected key version/,
    );
  });

  it('accepts a string digest as well as a buffer', async () => {
    const { provider, client } = makeProvider();
    await provider.sign(KEY, 'digest-as-string');

    expect(client.asymmetricSign.mock.calls[0][0].digest.sha256).toEqual(
      Buffer.from('digest-as-string'),
    );
  });
});

describe('key lifecycle', () => {
  it('creates a key with the signing purpose and returns its public PEM', async () => {
    const { provider, client } = makeProvider();
    const result = await provider.generateKey({ keyId: KEY });

    const request = client.createCryptoKey.mock.calls[0][0];
    expect(request.cryptoKeyId).toBe(KEY);
    expect(request.cryptoKey.purpose).toBe('ASYMMETRIC_SIGN');
    expect(result.publicPem).toContain('BEGIN PUBLIC KEY');
  });

  it('rotates by creating a version and promoting it', async () => {
    const { provider, client } = makeProvider();
    const result = await provider.rotateKey(KEY);

    expect(client.createCryptoKeyVersion).toHaveBeenCalled();
    expect(client.updateCryptoKeyPrimaryVersion).toHaveBeenCalledWith({
      name: CRYPTO_KEY,
      cryptoKeyVersionId: '2',
    });
    expect(result.keyId).toBe(VERSION_2);
  });

  it('disables a key version', async () => {
    const { provider, client } = makeProvider();
    const result = await provider.deactivateKey(KEY);

    expect(client.updateCryptoKeyVersion).toHaveBeenCalledWith({
      cryptoKeyVersion: { name: VERSION_1, state: 'DISABLED' },
      updateMask: { paths: ['state'] },
    });
    expect(result.active).toBe(false);
  });

  it('enables a key version', async () => {
    const { provider } = makeProvider();
    await expect(provider.activateKey(KEY)).resolves.toEqual({ keyId: KEY, active: true });
  });

  it('lists keys with their active state', async () => {
    const client = fakeClient({
      listCryptoKeys: jest.fn(async () => [[
        {
          name: CRYPTO_KEY,
          primary: { state: 'ENABLED' },
          versionTemplate: { algorithm: 'EC_SIGN_P256_SHA256' },
          createTime: { seconds: 1700000000 },
        },
      ]]),
    });
    const { provider } = makeProvider(client);

    const keys = await provider.listKeys();

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ keyId: CRYPTO_KEY, active: true });
    expect(keys[0].createdAt).toMatch(/^2023-/);
  });

  it('returns an empty list rather than throwing when the ring has no keys', async () => {
    const { provider } = makeProvider(fakeClient({ listCryptoKeys: jest.fn(async () => [null]) }));

    await expect(provider.listKeys()).resolves.toEqual([]);
  });
});

describe('no raw secret material', () => {
  it('never exposes a private key on the provider', async () => {
    const { provider } = makeProvider();
    const pub = await provider.getPublicKey(KEY);

    // The whole point of the adapter: the keeper holds a resource name, not a
    // secret, so a memory dump yields nothing that can move funds.
    expect(JSON.stringify(pub)).not.toMatch(/PRIVATE KEY/);
    expect(provider.secretKey).toBeUndefined();
  });
});
