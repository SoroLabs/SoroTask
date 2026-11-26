# Multi-tenant API gateway

The optional keeper API gateway protects `/admin/*` routes with project API
keys or project-scoped JWTs, HMAC-signed requests, role checks, and Redis-backed
per-project token buckets. Health and Prometheus scrape endpoints remain
available to monitoring systems.

## Configuration

Set `API_GATEWAY_ENABLED=true` and provide `API_GATEWAY_PROJECTS` as a JSON
object keyed by project ID. Use a secret manager to populate the environment;
do not commit credentials.

```json
{
  "acme": {
    "tier": "PRO",
    "apiKeys": [
      {
        "keyId": "acme-prod-2026",
        "hmacSecret": "<at-least-32-random-bytes>",
        "jwtSecret": "<optional-at-least-32-random-bytes>",
        "roles": ["read", "write"]
      }
    ]
  }
}
```

Tier names are `FREE`, `PRO`, and `ENTERPRISE`. The token bucket starts with
`capacity + burst` tokens and replenishes at the tier's `refillPerSecond` rate.
Every key belonging to a project shares the same project quota. Roles are
`read`, `write`, and `admin`; `write` includes read access, while `admin`
includes both.

The gateway requires a real `REDIS_URL` when enabled. Without a distributed
Redis client, protected requests fail closed with `503`; process-local fallback
is not treated as a cluster-wide quota store. Redis errors also fail closed.
Request nonces and bucket state use separate Redis key prefixes.

## Request authentication

Every protected request must include a millisecond Unix timestamp, a unique
base64url nonce of at least 16 characters, and an HMAC-SHA256 signature:

```text
X-API-Key: acme-prod-2026
X-SoroTask-Timestamp: 1800000000000
X-SoroTask-Nonce: <unique-base64url-value>
X-SoroTask-Signature: <64-character-hex-hmac>
```

Sign the exact request target (path and query), method, timestamp, nonce, and
SHA-256 hash of the raw request body, joined with periods:

```text
timestamp.nonce.METHOD.path.sha256(rawBody)
```

The HMAC key is the configured `hmacSecret`. Requests outside the five-minute
timestamp tolerance, with invalid signatures, or with a previously used nonce
are rejected. JSON bodies must be signed using the exact bytes sent on the
wire.

For JWT authorization, send `Authorization: Bearer <JWT>` instead of
`X-API-Key`. The JWT must use HS256, identify the registered key ID in its
`kid` header, and contain `projectId`, `sub`, `roles`, and an unexpired `exp`
claim. It is signed using that key's configured `jwtSecret`. The JWT roles may
not exceed the roles assigned to the key. HMAC request signing remains
mandatory for JWT-authenticated requests.

Read-only HTTP methods require `read`; other methods require `write`. A key
with `admin` may use either. Rejected role checks return `403`, malformed or
replayed credentials return `401`, and exhausted project quotas return `429`
with `Retry-After` and `X-RateLimit-*` headers.

## Observability

Prometheus scrapes at `/metrics` or `/metrics/prometheus` include
`keeper_api_gateway_requests_total`, labeled by bounded tier, method, and
outcome values. Project IDs, key IDs, and raw credentials are not Prometheus
labels. `/admin/billing` returns usage for only the authenticated project.
