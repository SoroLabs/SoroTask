# Structured Error Codes

Keeper and contract-adjacent flows emit structured errors via `keeper/src/structuredErrors.js`.

## Shape

Server logs use `toLogPayload()`:

```json
{
  "code": "SIMULATION_FAILED",
  "category": "contract",
  "message": "Simulation failed: ...",
  "correlationId": "abc-123",
  "metadata": { "taskId": 1 }
}
```

HTTP clients receive `toClientPayload()`:

```json
{
  "error": {
    "code": "SIMULATION_FAILED",
    "category": "contract",
    "message": "Simulation failed: ...",
    "correlationId": "abc-123"
  }
}
```

Stacks, secrets, and bearer tokens are never included in client payloads.

## Categories

| Category | Examples |
|----------|----------|
| `rpc` | `TX_BAD_SEQ`, `TX_TOO_LATE` |
| `contract` | `SIMULATION_FAILED`, `INSUFFICIENT_GAS` |
| `validation` | `INVALID_ARGS`, `VALIDATION_ERROR` |
| `network` | `NETWORK_ERROR`, `TIMEOUT_ERROR`, `RATE_LIMITED` |
| `execution` | `TX_FAILED`, `DUPLICATE_TRANSACTION` |
| `auth` | `TX_BAD_AUTH`, `INVALID_TOKEN` |

Frontend `contractErrors.ts` maps the same codes for user-facing copy.
