# Keeper Admin API Documentation

The SoroTask Keeper includes an Admin API for operational control during incidents. This allows maintainers to safely pause and resume risky backend behavior without shutting down the entire service.

## Configuration

The Admin API is configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_PORT` | The port the Admin API will listen on. | `3002` |
| `ADMIN_TOKEN` | A secret token used for Bearer authentication. **Required** for the API to function. | None |

## Authentication

All requests to the Admin API must include an `Authorization` header:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

If `ADMIN_TOKEN` is not set in the environment, the Admin API will return `403 Forbidden` for all requests.

## Endpoints

### GET /admin/status

Returns the current operational state of the Keeper.

**Response:**
```json
{
  "status": "ok",
  "state": {
    "isPollingPaused": false,
    "isExecutionPaused": false
  }
}
```

### POST /admin/pause

Pauses specific Keeper operations.

**Request Body:**
```json
{
  "target": "polling" | "execution" | "all"
}
```

- `polling`: Stops the Keeper from checking the blockchain for due tasks.
- `execution`: Stops the Keeper from submitting transactions for due tasks.
- `all`: Pauses both polling and execution.

### POST /admin/resume

Resumes specific Keeper operations.

**Request Body:**
```json
{
  "target": "polling" | "execution" | "all"
}
```

## Incident Response Use Cases

### 1. Smart Contract Bug
If a bug is discovered in a target smart contract that causes tasks to fail or behave unexpectedly, use `POST /admin/pause` with `{ "target": "execution" }`. This stops the Keeper from submitting transactions while keeping polling active so you can still monitor task backlog via metrics.

### 2. RPC Node Instability
If the Soroban RPC node is experiencing high latency or errors, use `POST /admin/pause` with `{ "target": "polling" }`. This stops the Keeper from hammering the RPC node with read requests until the infrastructure is stabilized.

### 3. Keeper Maintenance
Before performing database maintenance or minor updates, use `POST /admin/pause` with `{ "target": "all" }` to ensure no new work is started while you perform the maintenance.

## Important Caveats

- **In-flight Work**: Pausing execution does **not** cancel transactions that have already been submitted to the network. Those will run to completion.
- **Task Backlog**: While execution is paused, tasks that become due will remain "due" on the blockchain. When execution is resumed, the Keeper will attempt to process all accumulated due tasks in the next cycle.
- **Visibility**: The Metrics server and Health Check endpoints remain active even when operations are paused, providing continuous visibility into the service state.
