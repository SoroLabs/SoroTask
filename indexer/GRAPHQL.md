# SoroTask GraphQL API

This document describes the GraphQL API built into the `indexer` service. It provides deep, field-level role-based access control, allowing consumers to securely query indexed contract events, tasks, and reconciliation logs.

## Overview

The API is powered by **Apollo Server** and **Express**, sitting directly on top of the `indexer`'s SQLite database to serve high-performance reads for the SoroTask platform.

### Roles and Authorization

The API supports complex authorization scenarios using JWT-based Context verification.

| Role | Access Level | Description |
| ---- | ------------ | ----------- |
| `ADMIN` | **3** | Full access to all resources. Can pause any task, view whitelists, and access all fields. |
| `OPERATOR` | **2** | Operational access. Can view reconciliation logs, but cannot pause arbitrary tasks. |
| `USER` | **1** | Standard access. Can view public tasks and events. Can pause their *own* tasks and view their *own* whitelists/block reasons. |
| `ANONYMOUS` | **0** | Unauthenticated. Can only view public information (Tasks, Events). |

### Endpoints
- **URL**: `http://localhost:4000/graphql`
- **Method**: `POST`
- **Headers**:
  - `Authorization: Bearer <JWT_TOKEN>`
  - `Content-Type: application/json`

---

## Schema Explorer

### Queries

#### `me: User`
Returns the currently authenticated user's details.

#### `tasks(limit: Int, offset: Int): [Task!]!`
Returns a paginated list of all registered tasks.

#### `task(id: ID!): Task`
Fetches a single task by ID. Note: Fields like `whitelist_json` and `blocked_by_json` are restricted to `ADMIN` or the task's Creator.

#### `events(task_id: Int, limit: Int, offset: Int): [Event!]!`
Fetches blockchain events. Optionally filter by a specific `task_id`.

#### `executionHistory(task_id: Int, limit: Int, offset: Int): [ExecutionHistory!]!`
Fetches keeper execution outcomes (fee paid, ledger sequence), derived from `KeeperPaid` events. Optionally filter by `task_id`.

#### `reconciliationLogs(task_id: Int, limit: Int, offset: Int): [ReconciliationLog!]!`
**(Requires OPERATOR or ADMIN role)**
Fetches background reconciliation logs.

---

### Mutations

#### `loginDemo(address: String!, role: String): AuthPayload!`
*Development/Testing only.* Generates a signed JWT for testing different roles.

#### `pauseTask(id: ID!): Task`
Sets a task to inactive (`is_active = 0`).
- **Authorization**: The caller must either be an `ADMIN` or the `Creator` of the task.

---

### Subscriptions (Issue #824)

#### `eventAdded(task_id: Int, contract_id: String): Event!`
Streams newly indexed contract events (task registrations, executions, gas deposits, ...) in real time over a WebSocket connection. Optionally filter by `task_id` or `contract_id`.

- **URL**: `ws://localhost:4000/graphql` (same host/port as the HTTP API)
- **Protocol**: [`subscriptions-transport-ws`](https://github.com/apollographql/subscriptions-transport-ws) (`graphql-ws` legacy sub-protocol) - compatible with Apollo Client's `WebSocketLink`/`GraphQLWsLink` configured for that protocol, or `subscriptions-transport-ws`'s `SubscriptionClient` directly.
- Subscriptions only exist on the WebSocket transport; plain HTTP `POST /graphql` requests only ever serve queries/mutations and never block on them.

```graphql
subscription {
  eventAdded(task_id: 42) {
    id
    event_name
    task_id
    data_json
    processed_at
  }
}
```

---

## Development and Testing

The GraphQL API is tightly integrated with the existing `indexer.db`. To run tests:
\`\`\`bash
cd indexer
npm test
\`\`\`

The test suite validates:
1. Role Hierarchy Enforcement
2. JWT Verification
3. Ownership Detection
4. Field-level isolation

---

## Integration with Infrastructure
The API server is initialized automatically alongside the indexer event loop inside `indexer/src/index.js` and defaults to port `4000`. You can change this via the `PORT` environment variable.
