const crypto = require('crypto');

const DEFAULT_SIGNATURE_HEADER = 'x-sorotask-signature';
const DEFAULT_TIMESTAMP_HEADER = 'x-sorotask-timestamp';
const DEFAULT_NONCE_HEADER = 'x-sorotask-nonce';
const DEFAULT_KEY_ID_HEADER = 'x-sorotask-key-id';
const DEFAULT_TOLERANCE_MS = 300000;
const DEFAULT_REPLAY_TTL_MS = 600000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(String(left), 'hex');
  const rightBuffer = Buffer.from(String(right), 'hex');
  return (
    leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function normalizeHeaderName(name) {
  return String(name || '').toLowerCase();
}

function getHeader(headers = {}, name) {
  const normalizedName = normalizeHeaderName(name);
  const found = Object.keys(headers).find((key) => normalizeHeaderName(key) === normalizedName);
  const value = found ? headers[found] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function parseSignatureHeader(value) {
  if (!value) {
    return {};
  }
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((parsed, part) => {
      const [version, signature] = part.split('=');
      if (version && signature) {
        parsed[version.trim()] = signature.trim();
      }
      return parsed;
    }, {});
}

function parseSecretMap(value, defaultKeyId = 'primary') {
  if (!value) {
    return new Map();
  }
  if (value instanceof Map) {
    return new Map(value);
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return new Map(Object.entries(value).filter(([, secret]) => Boolean(secret)));
  }

  const raw = String(value).trim();
  if (!raw) {
    return new Map();
  }

  const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  const pairs = entries
    .map((entry) => {
      const separatorIndex = entry.indexOf(':');
      if (separatorIndex === -1) {
        return [defaultKeyId, entry];
      }
      return [
        entry.slice(0, separatorIndex).trim(),
        entry.slice(separatorIndex + 1).trim(),
      ];
    })
    .filter(([keyId, secret]) => keyId && secret);

  return new Map(pairs);
}

function buildCanonicalRequest({ method, path, timestamp, nonce, body }) {
  const bodyHash = sha256Hex(body);
  return [
    String(timestamp),
    String(nonce),
    String(method || 'POST').toUpperCase(),
    String(path || '/'),
    bodyHash,
  ].join('.');
}

function signWebhookRequest({ method = 'POST', path = '/', timestamp, nonce, body = '', secret }) {
  const canonical = buildCanonicalRequest({ method, path, timestamp, nonce, body });
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

class InMemoryReplayStore {
  constructor(options = {}) {
    this.entries = new Map();
    this.maxEntries = options.maxEntries || 10000;
  }

  consume(key, ttlMs, now = Date.now()) {
    this.prune(now);
    if (this.entries.has(key)) {
      return false;
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
    this.entries.set(key, now + ttlMs);
    return true;
  }

  prune(now = Date.now()) {
    this.entries.forEach((expiresAt, key) => {
      if (expiresAt <= now) {
        this.entries.delete(key);
      }
    });
  }

  size(now = Date.now()) {
    this.prune(now);
    return this.entries.size;
  }
}

class WebhookAuthProtocol {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.defaultKeyId = options.defaultKeyId || 'primary';
    this.secrets = parseSecretMap(options.secrets || options.secret, this.defaultKeyId);
    this.toleranceMs = options.toleranceMs || DEFAULT_TOLERANCE_MS;
    this.replayTtlMs = options.replayTtlMs || DEFAULT_REPLAY_TTL_MS;
    this.maxBodyBytes = options.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
    this.replayStore = options.replayStore || new InMemoryReplayStore();
    this.headers = {
      signature: options.signatureHeader || DEFAULT_SIGNATURE_HEADER,
      timestamp: options.timestampHeader || DEFAULT_TIMESTAMP_HEADER,
      nonce: options.nonceHeader || DEFAULT_NONCE_HEADER,
      keyId: options.keyIdHeader || DEFAULT_KEY_ID_HEADER,
    };

    if (this.enabled && this.secrets.size === 0) {
      throw new Error('At least one inbound webhook secret is required when webhooks are enabled');
    }
  }

  verify({ method = 'POST', path = '/', headers = {}, rawBody = '', now = Date.now() }) {
    if (!this.enabled) {
      return { ok: false, status: 404, reason: 'webhooks_disabled' };
    }
    if (Buffer.byteLength(rawBody || '') > this.maxBodyBytes) {
      return { ok: false, status: 413, reason: 'body_too_large' };
    }

    const timestamp = getHeader(headers, this.headers.timestamp);
    const nonce = getHeader(headers, this.headers.nonce);
    const keyId = getHeader(headers, this.headers.keyId) || this.defaultKeyId;
    const signatures = parseSignatureHeader(getHeader(headers, this.headers.signature));
    const providedSignature = signatures.v1;

    if (!timestamp || !nonce || !providedSignature) {
      return { ok: false, status: 401, reason: 'missing_auth_headers' };
    }

    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs)) {
      return { ok: false, status: 401, reason: 'invalid_timestamp' };
    }
    if (Math.abs(now - timestampMs) > this.toleranceMs) {
      return { ok: false, status: 401, reason: 'timestamp_out_of_window' };
    }

    const secret = this.secrets.get(keyId);
    if (!secret) {
      return { ok: false, status: 401, reason: 'unknown_key_id' };
    }

    const expectedSignature = signWebhookRequest({
      method,
      path,
      timestamp,
      nonce,
      body: rawBody,
      secret,
    });

    if (!timingSafeEqualHex(expectedSignature, providedSignature)) {
      return { ok: false, status: 401, reason: 'signature_mismatch' };
    }

    const replayKey = `${keyId}:${timestamp}:${nonce}:${providedSignature}`;
    if (!this.replayStore.consume(replayKey, this.replayTtlMs, now)) {
      return { ok: false, status: 409, reason: 'replay_detected' };
    }

    return {
      ok: true,
      keyId,
      nonce,
      timestamp: timestampMs,
      bodyHash: sha256Hex(rawBody),
    };
  }

  createTestHeaders({ method = 'POST', path = '/', body = '', keyId = this.defaultKeyId, nonce, timestamp }) {
    const secret = this.secrets.get(keyId);
    const resolvedTimestamp = timestamp || Date.now();
    const resolvedNonce = nonce || crypto.randomBytes(16).toString('hex');
    return {
      [this.headers.keyId]: keyId,
      [this.headers.timestamp]: String(resolvedTimestamp),
      [this.headers.nonce]: resolvedNonce,
      [this.headers.signature]: `v1=${signWebhookRequest({
        method,
        path,
        timestamp: resolvedTimestamp,
        nonce: resolvedNonce,
        body,
        secret,
      })}`,
    };
  }
}

function validateTaskExecutionPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'invalid_json_payload' };
  }
  if (payload.type !== 'task.execute') {
    return { ok: false, reason: 'unsupported_event_type' };
  }
  if (!payload.eventId || typeof payload.eventId !== 'string') {
    return { ok: false, reason: 'missing_event_id' };
  }
  const taskId = Number(payload.taskId);
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    return { ok: false, reason: 'invalid_task_id' };
  }

  return {
    ok: true,
    value: {
      type: payload.type,
      eventId: payload.eventId,
      taskId,
      source: payload.source || 'external',
      reason: payload.reason || null,
      metadata: payload.metadata && typeof payload.metadata === 'object'
        ? payload.metadata
        : {},
    },
  };
}

module.exports = {
  DEFAULT_KEY_ID_HEADER,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_NONCE_HEADER,
  DEFAULT_REPLAY_TTL_MS,
  DEFAULT_SIGNATURE_HEADER,
  DEFAULT_TIMESTAMP_HEADER,
  DEFAULT_TOLERANCE_MS,
  InMemoryReplayStore,
  WebhookAuthProtocol,
  buildCanonicalRequest,
  parseSecretMap,
  signWebhookRequest,
  validateTaskExecutionPayload,
};
