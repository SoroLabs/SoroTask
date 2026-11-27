'use strict';

const crypto = require('crypto');
const { performance } = require('perf_hooks');

const PLAINTEXT_KEY_FIELDS = new Set([
  'privatekey',
  'private_key',
  'privatekeybase64',
  'secretkey',
  'secret_key',
  'secret',
  'seed',
  'mnemonic',
  'passphrase',
  'keeper_secret',
  'keepersecret',
  'secretaccesskey',
  'sessiontoken',
]);

const ALLOWED_META_FIELDS = new Set([
  'keyId',
  'keyArn',
  'publicPem',
  'algorithm',
  'active',
  'createdAt',
  'lastRotatedAt',
  'provider',
  'fingerprint',
  'version',
]);

const DEFAULT_LATENCY_BUDGET_MS = 50;
const DEFAULT_SIGN_TIMEOUT_MS = 3000;
const MAX_LATENCY_SAMPLES = 1000;

function _envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function _envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

/** Reject any option that could carry raw key material into process memory. */
function assertNoPlaintextKeys(value, context = 'kms') {
  if (!value || typeof value !== 'object') return true;

  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    for (const [key, nested] of Object.entries(current)) {
      if (PLAINTEXT_KEY_FIELDS.has(key.toLowerCase())) {
        throw new Error(
          `${context}: plaintext key material (${key}) is not accepted; keys must remain in KMS`,
        );
      }
      if (nested && typeof nested === 'object') stack.push(nested);
    }
  }
  return true;
}

/** Strip everything except public metadata before it reaches disk. */
function sanitizeKeyMetadata(entry = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!ALLOWED_META_FIELDS.has(key) || value === undefined) continue;
    clean[key] = typeof value === 'string' ? value.slice(0, 8192) : value;
  }
  assertNoPlaintextKeys(clean, 'key metadata');
  return clean;
}

function normalizeProvider(provider) {
  const value = String(provider || '').toLowerCase().replace(/[\s_]/g, '-');
  if (value === 'aws' || value === 'aws-kms' || value === 'amazon' || value === 'amazon-kms') {
    return 'aws-kms';
  }
  if (
    value === 'gcp' ||
    value === 'gcp-kms' ||
    value === 'google' ||
    value === 'google-kms' ||
    value === 'cloud-kms'
  ) {
    return 'gcp-kms';
  }
  throw new Error(`Unsupported KMS provider: ${provider}`);
}

function normalizeDigest(digest) {
  assertNoPlaintextKeys(digest, 'digest');
  if (Buffer.isBuffer(digest)) return Buffer.from(digest);
  if (digest instanceof Uint8Array) return Buffer.from(digest);
  if (digest instanceof ArrayBuffer) return Buffer.from(digest);
  if (typeof digest === 'string') {
    if (/^[0-9a-f]{64}$/i.test(digest)) return Buffer.from(digest, 'hex');
    if (/^[0-9a-f]{128}$/i.test(digest)) return Buffer.from(digest, 'hex');
    return Buffer.from(digest, 'utf8');
  }
  throw new Error('KMS signer: digest must be a Buffer, Uint8Array or string');
}

function derToPem(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const base64 = buf.toString('base64');
  const lines = base64.match(/.{1,64}/g) || [];
  return ['-----BEGIN PUBLIC KEY-----', ...lines, '-----END PUBLIC KEY-----'].join('\n');
}

function publicKeyBuffer(result = {}) {
  let pem = result.publicPem;
  if (!pem && result.publicKey) {
    const bytes = Buffer.isBuffer(result.publicKey)
      ? result.publicKey
      : Buffer.from(result.publicKey);
    pem = bytes.toString('utf8').includes('BEGIN PUBLIC KEY')
      ? bytes.toString('utf8')
      : derToPem(bytes);
  }
  if (!pem) throw new Error('KMS signer: provider returned no public key');

  const buffer = Buffer.from(pem, 'utf8');
  Object.defineProperties(buffer, {
    keyId: { value: result.keyId, enumerable: true },
    publicPem: { value: pem, enumerable: true },
    algorithm: { value: result.algorithm, enumerable: true },
    active: { value: result.active !== false, enumerable: true },
    provider: { value: result.provider, enumerable: true },
  });
  return buffer;
}

function crc32c(buffer) {
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

function withTimeout(promise, timeoutMs, label) {
  if (!timeoutMs || timeoutMs <= 0) return Promise.resolve(promise);
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}

function percentile(samples, fraction) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

class KmsSignError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'KmsSignError';
    this.code = code;
    this.details = details;
  }
}

/**
 * AWS KMS adapter. The key is generated and used inside KMS; the keeper only
 * ever holds the key identifier and the public key needed for verification.
 */
class AwsKmsAdapter {
  constructor(options = {}) {
    this.provider = 'aws-kms';
    this.cloud = 'aws';
    this.region = options.region || process.env.AWS_KMS_REGION || process.env.AWS_REGION;
    this.client = options.client || options.kmsClient || options.awsClient || null;
    this.clientConfig = options.clientConfig || {};
    this.signingAlgorithm = options.signingAlgorithm || 'ED25519';
    this.messageType = options.messageType || 'RAW';
  }

  _getClient() {
    if (!this.client) {
      const { KMSClient } = require('@aws-sdk/client-kms');
      this.client = new KMSClient({
        ...(this.region ? { region: this.region } : {}),
        ...this.clientConfig,
      });
    }
    return this.client;
  }

  _command(name, input) {
    try {
      const sdk = require('@aws-sdk/client-kms');
      const Command = sdk[name];
      if (Command) return new Command(input);
    } catch (error) {
      if (!this.client) throw error;
    }
    return { input };
  }

  async getPublicKey(keyId) {
    const result = await this._getClient().send(
      this._command('GetPublicKeyCommand', { KeyId: keyId }),
    );
    if (!result || !result.PublicKey) {
      throw new KmsSignError('AWS KMS did not return a public key', 'KMS_PUBLIC_KEY_MISSING');
    }
    return {
      keyId,
      publicKey: Buffer.from(result.PublicKey),
      provider: this.provider,
      algorithm: result.KeySpec || this.signingAlgorithm,
      active: true,
      requestId: result.$metadata && result.$metadata.requestId,
    };
  }

  async sign(keyId, digest, options = {}) {
    const result = await this._getClient().send(
      this._command('SignCommand', {
        KeyId: keyId,
        Message: digest,
        MessageType: options.messageType || this.messageType,
        SigningAlgorithm: options.signingAlgorithm || this.signingAlgorithm,
      }),
    );
    if (!result || !result.Signature) {
      throw new KmsSignError('AWS KMS did not return a signature', 'KMS_SIGNATURE_MISSING');
    }
    return {
      signature: Buffer.from(result.Signature),
      requestId: result.$metadata && result.$metadata.requestId,
      keyId,
      algorithm: options.signingAlgorithm || this.signingAlgorithm,
    };
  }

  /** Metadata used to correlate the local audit entry with the CloudTrail event. */
  cloudAuditMetadata(result = {}) {
    return {
      auditSource: 'cloudtrail',
      cloudTrail: {
        eventSource: 'kms.amazonaws.com',
        eventName: 'Sign',
        requestID: result.requestId || null,
      },
      eventSource: 'kms.amazonaws.com',
      eventName: 'Sign',
      requestId: result.requestId || null,
    };
  }
}

/** Google Cloud KMS adapter with integrity checks on request and response. */
class GcpKmsAdapter {
  constructor(options = {}) {
    this.provider = 'gcp-kms';
    this.cloud = 'gcp';
    this.projectId = options.projectId || process.env.GCP_KMS_PROJECT_ID;
    this.locationId = options.locationId || process.env.GCP_KMS_LOCATION || 'global';
    this.keyRingId = options.keyRingId || process.env.GCP_KMS_KEY_RING;
    this.client = options.client || options.kmsClient || options.gcpClient || null;
    this.clientConfig = options.clientConfig || {};
    this._versionCache = new Map();
  }

  _getClient() {
    if (!this.client) {
      const { KeyManagementServiceClient } = require('@google-cloud/kms');
      this.client = new KeyManagementServiceClient(this.clientConfig);
    }
    return this.client;
  }

  _requireRingConfig() {
    if (!this.projectId || !this.keyRingId) {
      throw new Error(
        'GCP KMS requires projectId and keyRingId (GCP_KMS_PROJECT_ID / GCP_KMS_KEY_RING)',
      );
    }
  }

  _cryptoKeyPath(keyId) {
    const name = String(keyId);
    if (name.includes('/cryptoKeys/')) return name;
    this._requireRingConfig();
    const client = this._getClient();
    if (typeof client.cryptoKeyPath === 'function') {
      return client.cryptoKeyPath(this.projectId, this.locationId, this.keyRingId, name);
    }
    return `projects/${this.projectId}/locations/${this.locationId}/keyRings/${this.keyRingId}/cryptoKeys/${name}`;
  }

  async _versionPath(keyId) {
    const name = String(keyId);
    if (name.includes('/cryptoKeyVersions/')) return name;
    if (this._versionCache.has(name)) return this._versionCache.get(name);

    const client = this._getClient();
    const path = this._cryptoKeyPath(name);
    let version = null;

    if (typeof client.getCryptoKey === 'function') {
      const result = await client.getCryptoKey({ name: path });
      const key = Array.isArray(result) ? result[0] : result;
      version = key && key.primary && key.primary.state === 'ENABLED' && key.primary.name;

      if (!version && typeof client.listCryptoKeyVersions === 'function') {
        const list = await client.listCryptoKeyVersions({ parent: path });
        const versions = Array.isArray(list) ? list[0] : list;
        const enabled = (versions || []).filter((v) => v && v.state === 'ENABLED');
        if (enabled.length === 0) {
          throw new KmsSignError(`No enabled Cloud KMS version for ${path}`, 'KMS_NO_ENABLED_VERSION');
        }
        version = enabled[enabled.length - 1].name;
      }
    }

    if (!version) version = `${path}/cryptoKeyVersions/1`;

    this._versionCache.set(name, version);
    return version;
  }

  async getPublicKey(keyId) {
    const name = await this._versionPath(keyId);
    const response = await this._getClient().getPublicKey({ name });
    const result = Array.isArray(response) ? response[0] : response;
    if (!result || (!result.pem && !result.publicKey)) {
      throw new KmsSignError('Cloud KMS did not return a public key', 'KMS_PUBLIC_KEY_MISSING');
    }
    const pem = result.pem || derToPem(result.publicKey);
    return {
      keyId,
      publicPem: pem,
      provider: this.provider,
      algorithm: result.algorithm,
      active: true,
      version: name,
    };
  }

  async sign(keyId, digest, options = {}) {
    const name = await this._versionPath(keyId);
    const digestType = options.digestType || 'sha256';
    const response = await this._getClient().asymmetricSign({
      name,
      digest: { [digestType]: digest },
      digestCrc32c: { value: crc32c(digest) },
    });
    const result = Array.isArray(response) ? response[0] : response;

    if (!result || !result.signature) {
      throw new KmsSignError('Cloud KMS did not return a signature', 'KMS_SIGNATURE_MISSING');
    }
    if (result.verifiedDigestCrc32c === false) {
      throw new KmsSignError('Cloud KMS digest CRC32C mismatch', 'KMS_DIGEST_CORRUPTED');
    }
    if (result.name && result.name !== name) {
      throw new KmsSignError('Cloud KMS signed with an unexpected key version', 'KMS_WRONG_VERSION');
    }
    const signature = Buffer.from(result.signature);
    if (result.signatureCrc32c && Number(result.signatureCrc32c.value) !== crc32c(signature)) {
      throw new KmsSignError('Cloud KMS signature CRC32C mismatch', 'KMS_SIGNATURE_CORRUPTED');
    }

    return { signature, requestId: result.requestId || null, keyId, version: name };
  }

  cloudAuditMetadata(result = {}) {
    return {
      auditSource: 'cloud-audit-logs',
      cloudAuditLog: {
        serviceName: 'cloudkms.googleapis.com',
        methodName: 'AsymmetricSign',
        resourceName: result.version || null,
      },
      eventSource: 'cloudkms.googleapis.com',
      eventName: 'AsymmetricSign',
      requestId: result.requestId || null,
      resourceName: result.version || null,
    };
  }
}

/**
 * Unified cloud KMS signer.
 *
 * No private key is ever accepted, generated, held or persisted by this class.
 * Every signature is produced by a remote KMS service using ambient IAM
 * credentials, and every attempt emits an audit entry carrying the metadata
 * needed to correlate it with CloudTrail (AWS) or Cloud Audit Logs (GCP).
 */
class KMSSigner {
  constructor(options = {}) {
    assertNoPlaintextKeys(options, 'KMSSigner');

    this.provider = normalizeProvider(
      options.provider || options.providerType || options.type || process.env.KMS_PROVIDER,
    );
    const configuredIds =
      options.keyIds ||
      (options.keyId ? [options.keyId] : []) ||
      [];
    const fallbackId = this.provider === 'aws-kms'
      ? process.env.KMS_KEY_ID
      : process.env.GCP_KMS_KEY_NAME;
    if (configuredIds.length === 0 && fallbackId) configuredIds.push(fallbackId);

    if (configuredIds.length === 0) {
      throw new Error('KMSSigner: keyId (or keyIds) is required');
    }
    this.keyIds = [...configuredIds];
    this.keyId = this.keyIds[0];

    this.audit = options.auditLogger || options.auditLog || options.audit || null;
    this.logger = options.logger || null;
    this.metrics = options.metrics || null;
    this.latencyBudgetMs =
      options.latencyBudgetMs !== undefined
        ? Number(options.latencyBudgetMs)
        : _envNumber('KMS_SIGN_LATENCY_BUDGET_MS', DEFAULT_LATENCY_BUDGET_MS);
    this.timeoutMs =
      options.timeoutMs !== undefined
        ? Number(options.timeoutMs)
        : _envNumber('KMS_SIGN_TIMEOUT_MS', DEFAULT_SIGN_TIMEOUT_MS);
    this.enforceLatencyBudget =
      options.enforceLatencyBudget !== undefined
        ? Boolean(options.enforceLatencyBudget)
        : _envFlag('KMS_ENFORCE_LATENCY_BUDGET');

    this.adapter =
      options.adapter ||
      (this.provider === 'aws-kms'
        ? new AwsKmsAdapter(options)
        : new GcpKmsAdapter(options));

    this._publicKeys = new Map();
    this._latencies = [];
    this._stats = {
      signTotal: 0,
      signSuccess: 0,
      signFailure: 0,
      budgetExceeded: 0,
      timeoutTotal: 0,
    };
  }

  _emitAudit(event, details) {
    if (!this.audit) return;
    const payload = { ...details, provider: this.provider, keyId: details.keyId || this.keyId };
    try {
      if (typeof this.audit.record === 'function') {
        this.audit.record(event, payload);
      } else if (typeof this.audit.logAuditEntry === 'function') {
        Promise.resolve(this.audit.logAuditEntry(event, payload)).catch(() => {});
      } else if (typeof this.audit === 'function') {
        this.audit(event, payload);
      }
    } catch (error) {
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn('KMS audit write failed', { error: error.message });
      }
    }
  }

  _increment(metric, value = 1) {
    if (this.metrics && typeof this.metrics.increment === 'function') {
      this.metrics.increment(metric, value);
    }
  }

  async init() {
    for (const keyId of this.keyIds) {
      const publicKey = await this.adapter.getPublicKey(keyId);
      this._publicKeys.set(keyId, publicKey);
    }
    this._emitAudit('signer.kms.init', { keyIds: this.keyIds });
    return this;
  }

  async getPublicKey(keyId = this.keyId) {
    if (!this._publicKeys.has(keyId)) {
      this._publicKeys.set(keyId, await this.adapter.getPublicKey(keyId));
    }
    return publicKeyBuffer({
      ...this._publicKeys.get(keyId),
      keyId,
      provider: this.provider,
    });
  }

  async getPublicKeyPem(keyId = this.keyId) {
    const publicKey = await this.getPublicKey(keyId);
    return publicKey.publicPem;
  }

  async sign(digest, options = {}) {
    assertNoPlaintextKeys(options, 'KMSSigner.sign');
    const keyId = options.keyId || this.keyId;
    const message = normalizeDigest(digest);
    const startedAt = performance.now();

    this._stats.signTotal += 1;
    this._increment('kmsSignTotal');

    let result;
    let error;
    try {
      result = await withTimeout(
        this.adapter.sign(keyId, message, options),
        this.timeoutMs,
        'KMS sign',
      );
    } catch (err) {
      error = err;
    }

    const latencyMs = performance.now() - startedAt;
    this._latencies.push(latencyMs);
    if (this._latencies.length > MAX_LATENCY_SAMPLES) this._latencies.shift();
    const withinBudget = latencyMs <= this.latencyBudgetMs;
    if (!withinBudget) {
      this._stats.budgetExceeded += 1;
      this._increment('kmsSignBudgetExceeded');
    }

    const auditDetails = {
      keyId,
      provider: this.provider,
      digestLength: message.length,
      digestSha256: crypto.createHash('sha256').update(message).digest('hex'),
      latencyMs: Number(latencyMs.toFixed(3)),
      latencyBudgetMs: this.latencyBudgetMs,
      withinBudget,
      success: !error,
      ...(result ? this.adapter.cloudAuditMetadata(result) : {}),
      ...(error ? { error: error.message, code: error.code || 'KMS_SIGN_FAILED' } : {}),
    };

    if (error) {
      this._stats.signFailure += 1;
      if (/timed out/.test(error.message)) {
        this._stats.timeoutTotal += 1;
        this._increment('kmsSignTimeout');
      }
      this._increment('kmsSignFailure');
      this._emitAudit('signer.kms.sign.error', auditDetails);
      throw error;
    }

    this._stats.signSuccess += 1;
    this._increment('kmsSignSuccess');
    this._increment('kmsSignLatencyMs', latencyMs);
    this._emitAudit('signer.kms.sign', auditDetails);

    if (!withinBudget) {
      const messageText = `KMS signature exceeded ${this.latencyBudgetMs}ms budget (${latencyMs.toFixed(1)}ms)`;
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn(messageText, { keyId, provider: this.provider });
      }
      if (this.enforceLatencyBudget) {
        throw new KmsSignError(messageText, 'KMS_LATENCY_BUDGET_EXCEEDED', auditDetails);
      }
    }

    return result.signature;
  }

  async signMany(digests, options = {}) {
    return Promise.all(digests.map((digest) => this.sign(digest, options)));
  }

  /** Sign a Stellar transaction in place without ever loading a secret key. */
  async signTransaction(transaction, options = {}) {
    const hash = transaction.hash();
    const signature = await this.sign(hash, options);
    const publicKey = await this.getPublicKey(options.keyId || this.keyId);
    const raw = rawPublicKeyFromPem(publicKey.publicPem);
    transaction.addDecoratedSignature(raw.slice(0, 4), signature);
    return transaction;
  }

  getStats() {
    return {
      ...this._stats,
      count: this._latencies.length,
      avgLatencyMs: this._latencies.length
        ? this._latencies.reduce((sum, ms) => sum + ms, 0) / this._latencies.length
        : 0,
      p50LatencyMs: percentile(this._latencies, 0.5),
      p95LatencyMs: percentile(this._latencies, 0.95),
      maxLatencyMs: this._latencies.length ? Math.max(...this._latencies) : 0,
      latencyBudgetMs: this.latencyBudgetMs,
      withinBudgetRate: this._stats.signTotal
        ? (this._stats.signTotal - this._stats.budgetExceeded) / this._stats.signTotal
        : 1,
    };
  }

  resetStats() {
    this._latencies = [];
    this._stats = {
      signTotal: 0,
      signSuccess: 0,
      signFailure: 0,
      budgetExceeded: 0,
      timeoutTotal: 0,
    };
  }
}

function rawPublicKeyFromPem(publicPem) {
  if (!publicPem) throw new Error('KMS signer: public key PEM is required');
  const base64 = String(publicPem)
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s/g, '');
  const der = Buffer.from(base64, 'base64');
  if (der.length < 32) throw new Error('KMS signer: invalid public key');
  return der.slice(-32);
}

function createKMSSigner(options = {}) {
  return new KMSSigner(options);
}

class AwsKmsSigner extends KMSSigner {
  constructor(options = {}) {
    super({ ...options, provider: 'aws-kms' });
  }
}

class GcpKmsSigner extends KMSSigner {
  constructor(options = {}) {
    super({ ...options, provider: 'gcp-kms' });
  }
}

module.exports = {
  KMSSigner,
  KmsSigner: KMSSigner,
  CloudKMSSigner: KMSSigner,
  AwsKmsSigner,
  GcpKmsSigner,
  AwsKmsAdapter,
  GcpKmsAdapter,
  KmsSignError,
  createKMSSigner,
  createKmsSigner: createKMSSigner,
  normalizeProvider,
  normalizeDigest,
  assertNoPlaintextKeys,
  sanitizeKeyMetadata,
  rawPublicKeyFromPem,
  crc32c,
  PLAINTEXT_KEY_FIELDS,
  DEFAULT_LATENCY_BUDGET_MS,
};
