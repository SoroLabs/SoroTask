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

/**
 * Redis-backed replay nonce store for distributed multi-instance deployments.
 *
 * Resolves issue #844: guarantees strict single-execution semantics for
 * webhooks across keeper cluster nodes by storing ephemeral nonces in Redis
 * with atomic SET NX + PX TTL operations, preventing replay attacks even when
 * multiple keeper instances share the same webhook endpoint.
 *
 * Usage:
 *   const store = new RedisReplayStore({ client: redisClient, keyPrefix: 'wh:nonce:' });
 *   const protocol = new WebhookAuthProtocol({ ..., replayStore: store });
 *
 * Note: consume() is async when using Redis. WebhookAuthProtocol.verify() must
 * be called with `await` when a RedisReplayStore is provided. Use the async
 * verifyAsync() method on WebhookAuthProtocol for distributed deployments.
 */
class RedisReplayStore {
  /**
   * @param {object} options
   * @param {object} options.client - ioredis or node-redis client instance.
   * @param {string} [options.keyPrefix='sorotask:wh:nonce:'] - Redis key namespace.
   */
  constructor(options = {}) {
    if (!options.client) {
      throw new Error('RedisReplayStore requires a Redis client instance');
    }
    this.client = options.client;
    this.keyPrefix = options.keyPrefix || 'sorotask:wh:nonce:';
  }

  /**
   * Atomically mark a nonce as seen. Returns false if the nonce was already
   * consumed (replay detected), true if it is fresh and has been stored.
   *
   * Uses SET key 1 NX PX <ttlMs> — a single round-trip atomic operation.
   *
   * @param {string} key - Composite replay key (keyId:timestamp:nonce:sig).
   * @param {number} ttlMs - Time-to-live in milliseconds.
   * @returns {Promise<boolean>} true if fresh, false if replayed.
   */
  async consume(key, ttlMs) {
    const redisKey = `${this.keyPrefix}${key}`;
    // SET NX returns 'OK' on first write, null when key already exists.
    const result = await this.client.set(redisKey, '1', 'NX', 'PX', Math.ceil(ttlMs));
    return result === 'OK' || result === 1;
  }

  /**
   * Synchronous fallback — always rejects to avoid silent no-ops when called
   * from the synchronous verify() path. Use verifyAsync() instead.
   */
  consumeSync(_key, _ttlMs) {
    throw new Error(
      'RedisReplayStore.consume() is asynchronous. ' +
      'Use WebhookAuthProtocol.verifyAsync() for Redis-backed nonce stores.',
    );
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

  /**
   * Async variant of verify() required when using a RedisReplayStore.
   *
   * Resolves issue #844: all header validation is identical to verify(), but
   * the final nonce-consumption step awaits an async Redis SET NX call so that
   * distributed keeper instances share a single source of truth for seen nonces.
   *
   * @param {object} params - Same as verify().
   * @returns {Promise<{ok: boolean, status?: number, reason?: string, keyId?: string, nonce?: string, timestamp?: number, bodyHash?: string}>}
   */
  async verifyAsync({ method = 'POST', path = '/', headers = {}, rawBody = '', now = Date.now() }) {
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

    // Atomic nonce consumption — works with both InMemoryReplayStore (sync)
    // and RedisReplayStore (async). The await is a no-op for sync stores.
    const replayKey = `${keyId}:${timestamp}:${nonce}:${providedSignature}`;
    const fresh = await Promise.resolve(
      this.replayStore.consume(replayKey, this.replayTtlMs, now),
    );
    if (!fresh) {
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
  RedisReplayStore,
  WebhookAuthProtocol,
  buildCanonicalRequest,
  parseSecretMap,
  signWebhookRequest,
  validateTaskExecutionPayload,
};
