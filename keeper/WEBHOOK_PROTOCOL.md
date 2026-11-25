# SoroTask Webhook Authentication and Validation Protocol

## Overview

This document describes the secure webhook authentication and validation protocol implemented for SoroTask. The protocol prevents replay attacks, validates request signatures, and provides a secure way for external systems to trigger task executions.

## Table of Contents

- [Security Features](#security-features)
- [Configuration](#configuration)
- [Protocol Specification](#protocol-specification)
- [Implementation Guide](#implementation-guide)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Security Features

### 1. HMAC-SHA256 Signature Verification

All webhook requests are signed using HMAC-SHA256 with a shared secret. The keeper verifies the signature before accepting any webhook.

- **Algorithm**: HMAC-SHA256
- **Constant-time Comparison**: Uses Node.js `crypto.timingSafeEqual()` to prevent timing attacks
- **Key Rotation**: Supports multiple keys via key IDs for seamless key rotation

### 2. Timestamp Validation

Timestamps prevent old requests from being processed:

- **Default Tolerance**: 5 minutes (300,000ms)
- **Configurable**: Can be adjusted via `INBOUND_WEBHOOK_TOLERANCE_MS`
- **Format**: Unix timestamp in milliseconds

### 3. Nonce-based Replay Attack Prevention

Multiple layers prevent replay attacks:

- **Primary Defense**: Nonce + timestamp + signature combination stored and tracked
- **Secondary Defense**: Event ID deduplication for task execution requests
- **Storage**: In-memory store with configurable TTL (default: 600 seconds)
- **Expiration**: Expired entries automatically pruned

### 4. Body Size Limits

Prevents denial-of-service attacks:

- **Default Limit**: 1 MB (1,048,576 bytes)
- **Configurable**: Via `INBOUND_WEBHOOK_MAX_BODY_BYTES`

### 5. Key Rotation Support

Multiple secrets can be configured and rotated without downtime:

- **Format**: `primary:secret1,backup:secret2,v2:secret3`
- **Default Key ID**: `primary` (configurable)
- **Transparent**: Old keys can be kept active during transition period

## Configuration

### Environment Variables

Enable and configure webhooks via environment variables:

```env
# Enable inbound webhooks
INBOUND_WEBHOOKS_ENABLED=true

# Secret key(s) - comma-separated key:secret pairs or single secret (uses "primary" by default)
INBOUND_WEBHOOK_SECRETS=primary:your-secret-key-here

# OR for a single secret (applies to "primary" key)
INBOUND_WEBHOOK_SECRET=your-secret-key-here

# Optional: Webhook endpoint path (default: /webhooks/task-executions)
INBOUND_WEBHOOK_PATH=/webhooks/task-executions

# Optional: Default key ID for single-secret setup (default: primary)
INBOUND_WEBHOOK_DEFAULT_KEY_ID=primary

# Optional: Timestamp tolerance in milliseconds (default: 300000 = 5 minutes)
INBOUND_WEBHOOK_TOLERANCE_MS=300000

# Optional: Replay detection TTL in milliseconds (default: 600000 = 10 minutes)
INBOUND_WEBHOOK_REPLAY_TTL_MS=600000

# Optional: Max request body size in bytes (default: 1048576 = 1 MB)
INBOUND_WEBHOOK_MAX_BODY_BYTES=1048576
```

### Configuration Validation

The keeper validates webhook configuration on startup:

```javascript
// Example: Multiple keys for rotation
INBOUND_WEBHOOK_SECRETS="primary:old-key-123,backup:new-key-456"
```

If webhooks are enabled but no secrets are configured, the keeper will fail to start with an error.

## Protocol Specification

### Request Format

Webhook requests must be HTTP POST requests with the following headers:

```http
POST /webhooks/task-executions HTTP/1.1
Host: keeper.example.com
Content-Type: application/json
x-sorotask-key-id: primary
x-sorotask-timestamp: 1716998400000
x-sorotask-nonce: a1b2c3d4e5f6
x-sorotask-signature: v1=<hex-encoded-signature>

{
  "type": "task.execute",
  "eventId": "evt-20240529-001",
  "taskId": 123,
  "source": "github-webhook",
  "reason": "deployment_complete",
  "metadata": {
    "deploymentId": "dep-999",
    "environment": "production"
  }
}
```

### Header Details

| Header | Required | Description |
|--------|----------|-------------|
| `x-sorotask-key-id` | No | Key ID for multi-key setup (default: primary) |
| `x-sorotask-timestamp` | Yes | Unix timestamp in milliseconds |
| `x-sorotask-nonce` | Yes | Unique random string (minimum 16 bytes) |
| `x-sorotask-signature` | Yes | Format: `v1=<signature>` |

### Request Payload

```json
{
  "type": "task.execute",
  "eventId": "string (required, unique per event)",
  "taskId": "number (required, must be positive integer)",
  "source": "string (optional, defaults to 'external')",
  "reason": "string (optional, null by default)",
  "metadata": "object (optional, empty object by default)"
}
```

### Signature Generation

The canonical request string is constructed as:

```
<timestamp>.<nonce>.<method>.<path>.<body-hash>
```

Where:
- `timestamp`: Request timestamp in milliseconds
- `nonce`: Random nonce value
- `method`: HTTP method (usually "POST")
- `path`: Request path (e.g., "/webhooks/task-executions")
- `body-hash`: SHA256 hash of request body in hex

The signature is the HMAC-SHA256 of the canonical string using the shared secret.

### Response Codes

| Code | Meaning | Details |
|------|---------|---------|
| 202 | Accepted | Task queued for execution |
| 400 | Bad Request | Invalid JSON, missing fields, invalid task ID |
| 401 | Unauthorized | Missing/invalid headers, signature mismatch, unknown key |
| 405 | Method Not Allowed | Request method is not POST |
| 409 | Conflict | Replay detected (duplicate event ID within TTL) |
| 413 | Payload Too Large | Request body exceeds size limit |
| 503 | Service Unavailable | Queue full or internal error |

### Success Response (202)

```json
{
  "status": "accepted",
  "eventId": "evt-20240529-001",
  "taskId": 123
}
```

### Error Response (401 example)

```json
{
  "error": "signature_mismatch"
}
```

## Implementation Guide

### Node.js / JavaScript

Here's how to generate and send a webhook request:

```javascript
const crypto = require('crypto');
const http = require('http');

const WEBHOOK_SECRET = 'your-secret-key-here';
const WEBHOOK_URL = 'http://localhost:3000/webhooks/task-executions';

function buildCanonicalRequest({ method, path, timestamp, nonce, body }) {
  const bodyHash = crypto
    .createHash('sha256')
    .update(body || '')
    .digest('hex');
  return `${timestamp}.${nonce}.${method}.${path}.${bodyHash}`;
}

function generateSignature({ method, path, timestamp, nonce, body, secret }) {
  const canonical = buildCanonicalRequest({ method, path, timestamp, nonce, body });
  return crypto
    .createHmac('sha256', secret)
    .update(canonical)
    .digest('hex');
}

function sendWebhook(taskId, eventId) {
  const path = '/webhooks/task-executions';
  const method = 'POST';
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  
  const body = JSON.stringify({
    type: 'task.execute',
    eventId,
    taskId,
    source: 'my-app',
    reason: 'manual-trigger'
  });

  const signature = generateSignature({
    method,
    path,
    timestamp,
    nonce,
    body,
    secret: WEBHOOK_SECRET
  });

  const headers = {
    'Content-Type': 'application/json',
    'x-sorotask-key-id': 'primary',
    'x-sorotask-timestamp': timestamp.toString(),
    'x-sorotask-nonce': nonce,
    'x-sorotask-signature': `v1=${signature}`
  };

  const url = new URL(WEBHOOK_URL);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: method,
    headers: headers
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Usage
sendWebhook(123, 'evt-' + Date.now())
  .then(result => console.log('Success:', result))
  .catch(error => console.error('Error:', error));
```

### Python Example

```python
import hmac
import hashlib
import json
import requests
import time
import os

WEBHOOK_SECRET = os.getenv('WEBHOOK_SECRET', 'your-secret-key')
WEBHOOK_URL = 'http://localhost:3000/webhooks/task-executions'

def build_canonical_request(method, path, timestamp, nonce, body):
    body_hash = hashlib.sha256(body.encode()).hexdigest()
    return f"{timestamp}.{nonce}.{method}.{path}.{body_hash}"

def generate_signature(method, path, timestamp, nonce, body, secret):
    canonical = build_canonical_request(method, path, timestamp, nonce, body)
    signature = hmac.new(
        secret.encode(),
        canonical.encode(),
        hashlib.sha256
    ).hexdigest()
    return signature

def send_webhook(task_id, event_id):
    path = '/webhooks/task-executions'
    method = 'POST'
    timestamp = int(time.time() * 1000)
    nonce = os.urandom(16).hex()
    
    payload = {
        'type': 'task.execute',
        'eventId': event_id,
        'taskId': task_id,
        'source': 'my-app',
        'reason': 'manual-trigger'
    }
    body = json.dumps(payload)
    
    signature = generate_signature(method, path, timestamp, nonce, body, WEBHOOK_SECRET)
    
    headers = {
        'Content-Type': 'application/json',
        'x-sorotask-key-id': 'primary',
        'x-sorotask-timestamp': str(timestamp),
        'x-sorotask-nonce': nonce,
        'x-sorotask-signature': f'v1={signature}'
    }
    
    response = requests.post(WEBHOOK_URL, data=body, headers=headers)
    return response.status_code, response.json()

# Usage
status, result = send_webhook(123, f'evt-{int(time.time() * 1000)}')
print(f'Status: {status}, Result: {result}')
```

## Examples

### Example 1: GitHub to SoroTask

Trigger a SoroTask when a GitHub workflow completes:

```javascript
// In your GitHub Actions workflow or webhook handler
const crypto = require('crypto');

function triggerSoroTask(taskId, githubEvent) {
  const eventId = `github-${githubEvent.action}-${githubEvent.timestamp}`;
  
  // ... generate signature as shown above ...
  
  const payload = {
    type: 'task.execute',
    eventId,
    taskId,
    source: 'github',
    reason: githubEvent.action,
    metadata: {
      repository: githubEvent.repository.full_name,
      branch: githubEvent.ref,
      runId: githubEvent.run_id
    }
  };
  
  // Send webhook
}
```

### Example 2: Scheduled Task Trigger

Trigger a task from a cron job:

```bash
#!/bin/bash

TASK_ID=42
EVENT_ID="cron-daily-$(date +%s)"
TIMESTAMP=$(date +%s000)
NONCE=$(openssl rand -hex 16)
SECRET="your-secret-key"
BODY="{\"type\":\"task.execute\",\"eventId\":\"$EVENT_ID\",\"taskId\":$TASK_ID,\"source\":\"cron\"}"

BODY_HASH=$(echo -n "$BODY" | sha256sum | cut -d' ' -f1)
CANONICAL="$TIMESTAMP.$NONCE.POST./webhooks/task-executions.$BODY_HASH"
SIGNATURE=$(echo -n "$CANONICAL" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)

curl -X POST http://localhost:3000/webhooks/task-executions \
  -H "Content-Type: application/json" \
  -H "x-sorotask-key-id: primary" \
  -H "x-sorotask-timestamp: $TIMESTAMP" \
  -H "x-sorotask-nonce: $NONCE" \
  -H "x-sorotask-signature: v1=$SIGNATURE" \
  -d "$BODY"
```

## Troubleshooting

### Common Issues

#### 1. "webhooks_disabled"

**Problem**: Webhook returns 404 with `webhooks_disabled` error.

**Solution**: Enable webhooks with `INBOUND_WEBHOOKS_ENABLED=true` and restart keeper.

#### 2. "missing_auth_headers"

**Problem**: Request rejected with missing auth headers.

**Solution**: Ensure all required headers are present:
- `x-sorotask-timestamp`
- `x-sorotask-nonce`
- `x-sorotask-signature`

#### 3. "timestamp_out_of_window"

**Problem**: Requests are rejected for timestamp being too old/new.

**Solution**: Verify system clocks are synchronized. Check tolerance setting:
- Default: 5 minutes
- Adjust via `INBOUND_WEBHOOK_TOLERANCE_MS` if needed

#### 4. "signature_mismatch"

**Problem**: Valid-looking signatures are rejected.

**Debugging**:
1. Verify the exact request body (must be identical to what was signed)
2. Check the signing secret matches the keeper's `INBOUND_WEBHOOK_SECRET`
3. Verify method is "POST" and path is correct
4. Use hex encoding for nonce/body hash

#### 5. "replay_detected"

**Problem**: Identical webhooks are rejected as replays.

**Solution**: 
- Generate new `eventId` for each request
- Generate new `nonce` for each request
- Use unique timestamp (millisecond precision)

#### 6. "event_replay_detected"

**Problem**: Same task is queued multiple times but webhook is rejected.

**Solution**: This is intentional - same event ID within TTL window is rejected. Use unique event IDs.

### Debugging

Enable debug logging:

```env
LOG_LEVEL=debug
```

Check logs for webhook-trigger messages:

```
[webhook-trigger] Accepted webhook task execution request
[webhook-trigger] Rejected webhook task execution request
```

## Best Practices

1. **Secret Management**
   - Use strong, randomly generated secrets (minimum 32 characters)
   - Store secrets securely (environment variables, secrets manager)
   - Rotate secrets regularly via key IDs
   - Never commit secrets to version control

2. **Event ID Generation**
   - Use globally unique identifiers
   - Include timestamp and source identifier
   - Example: `github-deploy-${timestamp}-${uniqueId}`

3. **Error Handling**
   - Log all webhook requests (accepted and rejected)
   - Monitor 409 (replay) responses for potential attacks
   - Set up alerts for repeated 401 (auth) failures

4. **Monitoring**
   - Track metrics: `webhookAcceptedTotal`, `webhookRejectedTotal`, `webhookReplayRejectedTotal`
   - Set up dashboards showing webhook success rate
   - Alert on high rejection rates

5. **Testing**
   - Use the webhook test header generation in `WebhookAuthProtocol.createTestHeaders()`
   - Test with wrong signatures, old timestamps, replay events
   - Verify exact request body format matches expectations

## Security Audit Checklist

- [ ] HMAC-SHA256 signatures verified for all requests
- [ ] Timestamp validation enabled with reasonable tolerance window
- [ ] Nonce uniqueness enforced per request
- [ ] Replay detection active (event IDs tracked)
- [ ] Timing-safe comparison used for signatures
- [ ] Request body size limited
- [ ] Secrets stored securely (not in logs or code)
- [ ] Key rotation tested and working
- [ ] Error messages don't leak security information
- [ ] Metrics collected and monitored
- [ ] Access logs maintained for audit trail
