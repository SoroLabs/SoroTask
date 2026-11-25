const { HSMProvider } = require('./provider');

/**
 * Google Cloud KMS signing provider (Issue #1053).
 *
 * Completes the KMS trio alongside AWS KMS and Vault Transit. As with those,
 * the private key is created inside the service and never leaves it — the
 * keeper holds a resource name, not a secret, so a process memory dump or a
 * compromised dependency yields nothing that can move funds.
 *
 * Two things differ from the AWS adapter and are worth knowing before reading
 * the code:
 *
 * - Cloud KMS addresses a *crypto key version*, not a key. Signing needs the
 *   full `.../cryptoKeys/<key>/cryptoKeyVersions/<n>` path, so a bare key id is
 *   resolved to its primary enabled version.
 * - Cloud KMS verifies an integrity CRC32C on both the request digest and the
 *   returned signature. Skipping that check would leave silent corruption on
 *   the wire undetected, so it is enforced rather than ignored.
 */
class GcpKmsProvider extends HSMProvider {
  constructor(opts = {}) {
    super(opts);
    this.projectId = opts.projectId || process.env.GCP_KMS_PROJECT_ID;
    this.locationId = opts.locationId || process.env.GCP_KMS_LOCATION || 'global';
    this.keyRingId = opts.keyRingId || process.env.GCP_KMS_KEY_RING;
    this.clientConfig = opts.clientConfig || {};
    // Ed25519 is not offered by Cloud KMS; EC_SIGN_P256_SHA256 is the closest
    // asymmetric signing algorithm it does offer.
    this.defaultAlgorithm = opts.algorithm || process.env.GCP_KMS_ALGORITHM
      || 'EC_SIGN_P256_SHA256';
  }

  _getClient() {
    if (!this._client) {
      const { KeyManagementServiceClient } = require('@google-cloud/kms');
      this._client = new KeyManagementServiceClient(this.clientConfig);
    }
    return this._client;
  }

  _requireRingConfig() {
    if (!this.projectId || !this.keyRingId) {
      throw new Error(
        'GCP KMS requires projectId and keyRingId (GCP_KMS_PROJECT_ID / GCP_KMS_KEY_RING)',
      );
    }
  }

  /** Fully-qualified key ring path. */
  _keyRingPath() {
    this._requireRingConfig();
    return this._getClient().keyRingPath(this.projectId, this.locationId, this.keyRingId);
  }

  /**
   * Accept either a bare key id or an already-qualified resource name, so
   * callers can hold whichever they were given without special-casing.
   */
  _cryptoKeyPath(keyId) {
    if (String(keyId).includes('/cryptoKeys/')) return String(keyId);
    this._requireRingConfig();
    return this._getClient().cryptoKeyPath(
      this.projectId,
      this.locationId,
      this.keyRingId,
      keyId,
    );
  }

  /**
   * Resolve a key to the version that actually signs.
   *
   * A version path is returned untouched. Otherwise the primary version is
   * preferred, falling back to the newest enabled one — a key whose primary has
   * been disabled during rotation can still sign with a live version rather
   * than failing outright.
   */
  async _resolveVersionPath(keyId) {
    const name = String(keyId);
    if (name.includes('/cryptoKeyVersions/')) return name;

    const client = this._getClient();
    const cryptoKeyPath = this._cryptoKeyPath(name);

    const [key] = await client.getCryptoKey({ name: cryptoKeyPath });
    if (key?.primary?.name && key.primary.state === 'ENABLED') return key.primary.name;

    const [versions] = await client.listCryptoKeyVersions({ parent: cryptoKeyPath });
    const enabled = (versions || []).filter((v) => v.state === 'ENABLED');
    if (enabled.length === 0) {
      throw new Error(`No enabled Cloud KMS key version for ${cryptoKeyPath}`);
    }

    // listCryptoKeyVersions returns ascending version order; the last is newest.
    return enabled[enabled.length - 1].name;
  }

  /** CRC32C over a buffer, as Cloud KMS expects for integrity verification. */
  _crc32c(buffer) {
    // Castagnoli polynomial, reflected. Computed here rather than pulled in as a
    // dependency: it is a dozen lines and the alternative is shipping a native
    // module into the keeper image for one checksum.
    const POLY = 0x82f63b78;
    let crc = 0xffffffff;

    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let bit = 0; bit < 8; bit++) {
        crc = crc & 1 ? (crc >>> 1) ^ POLY : crc >>> 1;
      }
    }

    return (crc ^ 0xffffffff) >>> 0;
  }

  _pemFromResponse(publicKey) {
    // Cloud KMS returns PEM directly, unlike KMS's DER.
    return publicKey?.pem || null;
  }

  async generateKey({ keyId, algorithm = this.defaultAlgorithm, usage = 'ASYMMETRIC_SIGN' } = {}) {
    const client = this._getClient();
    const parent = this._keyRingPath();

    const [key] = await client.createCryptoKey({
      parent,
      cryptoKeyId: keyId,
      cryptoKey: {
        purpose: usage,
        versionTemplate: { algorithm },
      },
    });

    const publicKey = await this.getPublicKey(key.name);
    return { keyId: key.name, publicPem: publicKey.publicPem };
  }

  async getPublicKey(keyId) {
    const client = this._getClient();
    const name = await this._resolveVersionPath(keyId);
    const [publicKey] = await client.getPublicKey({ name });

    return {
      keyId,
      publicPem: this._pemFromResponse(publicKey),
      algorithm: publicKey?.algorithm,
      active: true,
    };
  }

  /**
   * Sign a digest through Cloud KMS.
   *
   * The caller passes the same pre-hashed digest the AWS adapter takes
   * (`MessageType: 'DIGEST'`), keeping SigningService agnostic about which
   * provider is behind it.
   */
  async sign(keyId, data, options = {}) {
    const client = this._getClient();
    const name = await this._resolveVersionPath(keyId);
    const digest = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    const digestType = options.digestType || 'sha256';

    const [result] = await client.asymmetricSign({
      name,
      digest: { [digestType]: digest },
      digestCrc32c: { value: this._crc32c(digest) },
    });

    // Cloud KMS reports whether it received the digest intact and whether the
    // signature it returned is intact. Both are checked: a corrupted signature
    // that reached the network would be rejected far from where it broke.
    if (result.verifiedDigestCrc32c === false) {
      throw new Error('Cloud KMS reported a digest CRC32C mismatch — request corrupted in transit');
    }
    if (!result.name || result.name !== name) {
      throw new Error('Cloud KMS signed with an unexpected key version');
    }

    const signature = Buffer.from(result.signature);
    if (result.signatureCrc32c && Number(result.signatureCrc32c.value) !== this._crc32c(signature)) {
      throw new Error('Cloud KMS signature failed CRC32C verification — response corrupted');
    }

    return signature;
  }

  /** Create a new version and promote it, which is what rotation means here. */
  async rotateKey(keyId, _options = {}) {
    const client = this._getClient();
    const cryptoKeyPath = this._cryptoKeyPath(keyId);

    const [version] = await client.createCryptoKeyVersion({
      parent: cryptoKeyPath,
      cryptoKeyVersion: {},
    });

    await client.updateCryptoKeyPrimaryVersion({
      name: cryptoKeyPath,
      cryptoKeyVersionId: String(version.name).split('/').pop(),
    });

    const publicKey = await this.getPublicKey(version.name);
    return { keyId: version.name, publicPem: publicKey.publicPem };
  }

  async activateKey(keyId) {
    const client = this._getClient();
    const name = await this._resolveVersionPath(keyId);

    await client.updateCryptoKeyVersion({
      cryptoKeyVersion: { name, state: 'ENABLED' },
      updateMask: { paths: ['state'] },
    });

    return { keyId, active: true };
  }

  async deactivateKey(keyId) {
    const client = this._getClient();
    const name = await this._resolveVersionPath(keyId);

    await client.updateCryptoKeyVersion({
      cryptoKeyVersion: { name, state: 'DISABLED' },
      updateMask: { paths: ['state'] },
    });

    return { keyId, active: false };
  }

  async listKeys() {
    const client = this._getClient();
    const [keys] = await client.listCryptoKeys({ parent: this._keyRingPath() });

    return (keys || []).map((key) => ({
      keyId: key.name,
      active: key.primary ? key.primary.state === 'ENABLED' : true,
      algorithm: key.versionTemplate?.algorithm,
      createdAt: key.createTime?.seconds
        ? new Date(Number(key.createTime.seconds) * 1000).toISOString()
        : null,
    }));
  }
}

module.exports = { GcpKmsProvider };
