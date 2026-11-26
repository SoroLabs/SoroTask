const crypto = require('crypto');
const { buildCanonicalRequest, InMemoryReplayStore } = require('./webhookAuth');

const DEFAULT_GATEWAY_TOLERANCE_MS = 5 * 60 * 1000;
const DEFAULT_GATEWAY_REPLAY_TTL_MS = 10 * 60 * 1000;

class GatewayAuthError extends Error {
  constructor(message, statusCode = 401, code = 'unauthorized') {
    super(message);
    this.name = 'GatewayAuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function getHeader(headers, name) {
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function decodeJwtPart(value) {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('JWT segment must contain a JSON object');
    }
    return decoded;
  } catch (error) {
    throw new GatewayAuthError(`Malformed JWT: ${error.message}`);
  }
}

function safeEqualHex(expected, supplied) {
  if (!/^[a-f0-9]{64}$/i.test(supplied)) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function safeEqualBase64Url(expected, supplied) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(supplied)) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function verifyGatewayJwt(token, key, now = Date.now()) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || !key.jwtSecret) {
    throw new GatewayAuthError('Invalid JWT');
  }

  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (
    header.alg !== 'HS256'
    || (header.typ !== undefined && header.typ !== 'JWT')
    || header.kid !== key.keyId
  ) {
    throw new GatewayAuthError('Invalid JWT header');
  }

  const expected = crypto
    .createHmac('sha256', key.jwtSecret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest('base64url');
  if (!safeEqualBase64Url(expected, parts[2])) {
    throw new GatewayAuthError('Invalid JWT signature');
  }

  const nowSeconds = Math.floor(now / 1000);
  if (
    claims.projectId !== key.projectId
    || typeof claims.sub !== 'string'
    || claims.sub.length === 0
    || !Number.isSafeInteger(claims.exp)
    || claims.exp <= nowSeconds
    || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > nowSeconds))
    || (claims.iat !== undefined && (!Number.isSafeInteger(claims.iat) || claims.iat > nowSeconds + 30))
    || !Array.isArray(claims.roles)
    || claims.roles.some((role) => !key.roles.includes(role))
  ) {
    throw new GatewayAuthError('Invalid or expired JWT claims');
  }

  return {
    subject: claims.sub,
    roles: claims.roles,
  };
}

function signGatewayRequest({ method, path, timestamp, nonce, rawBody = '', secret }) {
  const canonical = buildCanonicalRequest({
    method,
    path,
    timestamp,
    nonce,
    body: rawBody,
  });
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

function signGatewayJwt({ keyId, projectId, subject, roles, secret, expiresAt, issuedAt }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT', kid: keyId });
  const payload = encode({
    projectId,
    sub: subject,
    roles,
    iat: issuedAt ?? Math.floor(Date.now() / 1000),
    exp: expiresAt,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(unsignedToken).digest('base64url');
  return `${unsignedToken}.${signature}`;
}

async function authenticateGatewayRequest(req, keyRegistry, options = {}) {
  const now = options.now ?? Date.now();
  const authorization = getHeader(req.headers, 'authorization');
  const apiKeyId = getHeader(req.headers, 'x-api-key');
  let key;
  let identity;
  let authType;

  if (authorization) {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) {
      throw new GatewayAuthError('Unsupported authorization scheme');
    }

    const parts = match[1].split('.');
    if (parts.length !== 3) {
      throw new GatewayAuthError('Bearer credentials must be a signed JWT');
    }
    const untrustedHeader = decodeJwtPart(parts[0]);
    key = keyRegistry.get(untrustedHeader.kid);
    if (!key) {
      throw new GatewayAuthError('Unknown API key');
    }
    identity = verifyGatewayJwt(match[1], key, now);
    if (apiKeyId && apiKeyId !== key.keyId) {
      throw new GatewayAuthError('API key does not match JWT');
    }
    authType = 'jwt';
  } else {
    key = keyRegistry.get(apiKeyId);
    if (!key) {
      throw new GatewayAuthError('Missing or unknown API key');
    }
    identity = { subject: key.keyId, roles: key.roles };
    authType = 'api_key';
  }

  const timestamp = getHeader(req.headers, 'x-sorotask-timestamp');
  const nonce = getHeader(req.headers, 'x-sorotask-nonce');
  const signature = getHeader(req.headers, 'x-sorotask-signature');
  const timestampMs = Number(timestamp);
  const rawBody = options.rawBody ?? '';

  if (
    !/^\d{10,16}$/.test(String(timestamp || ''))
    || !Number.isSafeInteger(timestampMs)
    || Math.abs(now - timestampMs) > (options.toleranceMs || DEFAULT_GATEWAY_TOLERANCE_MS)
    || !/^[A-Za-z0-9_-]{16,128}$/.test(String(nonce || ''))
    || !key.hmacSecret
    || typeof signature !== 'string'
  ) {
    throw new GatewayAuthError('Missing or invalid request signature');
  }

  const expectedSignature = signGatewayRequest({
    method: req.method,
    path: req.url,
    timestamp: String(timestamp),
    nonce,
    rawBody,
    secret: key.hmacSecret,
  });
  if (!safeEqualHex(expectedSignature, signature)) {
    throw new GatewayAuthError('Invalid request signature');
  }

  const replayStore = options.replayStore || new InMemoryReplayStore();
  const replayKey = crypto
    .createHash('sha256')
    .update(`${key.projectId}:${key.keyId}:${nonce}`)
    .digest('hex');
  const fresh = await replayStore.consume(
    replayKey,
    options.replayTtlMs || DEFAULT_GATEWAY_REPLAY_TTL_MS,
    now,
  );
  if (!fresh) {
    throw new GatewayAuthError('Request nonce has already been used', 401, 'replay');
  }

  return {
    projectId: key.projectId,
    keyId: key.keyId,
    tier: key.tier,
    subject: identity.subject,
    roles: identity.roles,
    authType,
  };
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice('Bearer '.length);
  const expected = process.env.KEEPER_ADMIN_TOKEN;

  if (!expected || !constantTimeEqual(token, expected)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = {
  DEFAULT_GATEWAY_REPLAY_TTL_MS,
  DEFAULT_GATEWAY_TOLERANCE_MS,
  GatewayAuthError,
  authenticateGatewayRequest,
  constantTimeEqual,
  requireAdminAuth,
  signGatewayJwt,
  signGatewayRequest,
  verifyGatewayJwt,
};
