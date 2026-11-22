# Inbound webhook trigger (Issue #780)

Lets an external event (a GitHub webhook, a price-spike alert, etc.) trigger
an immediate task evaluation instead of waiting for the next poll cycle.

Components
- `src/webhookAuth.js` — HMAC-SHA256 request signing/verification
  (`WebhookAuthProtocol`), replay protection (`InMemoryReplayStore` /
  `RedisReplayStore` for multi-instance keeper clusters), and payload
  validation.
- `src/webhookTrigger.js` — `WebhookTriggerHandler`, the actual HTTP request
  handler: reads the raw body (size-capped), verifies it, checks the event
  hasn't been replayed, and enqueues the task via the execution queue.
- Wired into the metrics server's HTTP listener in `index.js` — requests to
  the configured path (see below) are routed to
  `webhookTriggerHandler.handle(req, res)`.

## Configuration

| Env var | Default | |
|---|---|---|
| `INBOUND_WEBHOOKS_ENABLED` | `false` | Must be `true` to accept any webhook request |
| `INBOUND_WEBHOOK_PATH` | `/webhook/trigger` | Also always accepts `/webhooks/task-executions` |
| `INBOUND_WEBHOOK_SECRETS` | — | `secret` (single key) or `keyId1:secret1,keyId2:secret2` (multi-key) |
| `INBOUND_WEBHOOK_DEFAULT_KEY_ID` | `primary` | Used when the request omits a key ID header |
| `INBOUND_WEBHOOK_TOLERANCE_MS` | `300000` | Max clock skew for the timestamp header |
| `INBOUND_WEBHOOK_REPLAY_TTL_MS` | `600000` | How long a nonce is remembered to reject replays |
| `INBOUND_WEBHOOK_MAX_BODY_BYTES` | `1048576` | Request body size cap |

## Sending a request

Required headers (default names, configurable in `WebhookAuthProtocol`):

- `x-sorotask-key-id` — which configured secret to verify against
- `x-sorotask-timestamp` — ms since epoch
- `x-sorotask-nonce` — random per-request value
- `x-sorotask-signature` — `v1=<hex hmac>` of
  `{timestamp}.{nonce}.{METHOD}.{path}.{sha256(body)}`, signed with the
  secret for `key-id`, joined with `.`

Body (`Content-Type: application/json`):

```json
{
  "type": "task.execute",
  "eventId": "unique-per-event-id",
  "taskId": 42,
  "source": "github",
  "reason": "push to main",
  "metadata": { "sha": "abc123" }
}
```

`eventId` + `keyId` together form the replay-protection key — reusing an
`eventId` (even from a different source) within the replay TTL is rejected
with `409 event_replay_detected`.

## Response codes

| Status | Meaning |
|---|---|
| `202` | Accepted — task enqueued |
| `400` | Malformed JSON, unsupported `type`, or missing/invalid `taskId`/`eventId` |
| `401` | Missing/invalid signature, timestamp out of tolerance window, or unknown `keyId` |
| `403` | Method not `POST` |
| `409` | Replayed `eventId` |
| `413` | Body exceeds `INBOUND_WEBHOOK_MAX_BODY_BYTES` |
| `503` | Signature verified but the task couldn't be enqueued (queue error) |

## Multi-instance deployments

Use `RedisReplayStore` (pass a Redis client to `WebhookAuthProtocol`'s
`replayStore` option) so replay protection is shared across every keeper
instance behind the same webhook endpoint, rather than each instance
tracking nonces independently. Call `WebhookAuthProtocol.verifyAsync()`
instead of `.verify()` when using it — see `src/webhookAuth.js`'s
`RedisReplayStore` doc comment.
