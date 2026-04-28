# SoroTask — Event Indexing Strategy

This document provides a complete reference for all events emitted by the SoroTask contract, explains how to subscribe to and filter them, and compares different indexing strategies for production deployments.

---

## Table of Contents

1. [Event Overview](#event-overview)
2. [Event Reference](#event-reference)
   - [TaskRegistered](#taskregistered)
   - [TaskPaused](#taskpaused)
   - [TaskResumed](#taskresumed)
   - [TaskUpdated](#taskupdated)
   - [TaskCancelled](#taskcancelled)
   - [KeeperPaid](#keeperpaid)
   - [GasDeposited](#gasdeposited)
   - [GasWithdrawn](#gaswithdrawn)
3. [Subscribing to Events via Soroban RPC](#subscribing-to-events-via-soroban-rpc)
4. [Filtering Events](#filtering-events)
5. [Indexing Strategies](#indexing-strategies)
   - [Strategy 1: Custom Polling Bot](#strategy-1-custom-polling-bot)
   - [Strategy 2: Managed Indexer Service](#strategy-2-managed-indexer-service)
   - [Strategy 3: Keeper-Embedded Indexing](#strategy-3-keeper-embedded-indexing)
6. [Recommended Production Setup](#recommended-production-setup)

---

## Event Overview

SoroTask emits events at every significant state transition. Each event follows Soroban's standard structure:

- **Topics** — an ordered tuple used for filtering, always starting with an event name `Symbol` followed by the `task_id`.
- **Data** — the payload carrying addresses, amounts, or other relevant values.

| Event Name        | Triggering Function | Data Payload                          |
| ----------------- | ------------------- | ------------------------------------- |
| `TaskRegistered`  | `register()`        | `creator: Address`                    |
| `TaskPaused`      | `pause_task()`      | `creator: Address`                    |
| `TaskResumed`     | `resume_task()`     | `creator: Address`                    |
| `TaskUpdated`     | `update_task()`     | `creator: Address`                    |
| `TaskCancelled`   | `cancel_task()`     | `creator: Address`                    |
| `KeeperPaid`      | `execute()`         | `(keeper: Address, fee: i128)`        |
| `GasDeposited`    | `deposit_gas()`     | `(from: Address, amount: i128)`       |
| `GasWithdrawn`    | `withdraw_gas()`    | `(creator: Address, amount: i128)`    |

---

## Event Reference

### TaskRegistered

Emitted when a new task is successfully registered in the marketplace.

**Topics**

| Index | Type   | Value              |
| ----- | ------ | ------------------ |
| 0     | Symbol | `"TaskRegistered"` |
| 1     | u64    | `task_id`          |

**Data**

| Field     | Type    | Description                  |
| --------- | ------- | ---------------------------- |
| `creator` | Address | The address that registered the task |

**Use case:** Build your initial task registry. Every time this event fires, add the task to your local index so you can track its lifecycle.

---

### TaskPaused

Emitted when a task creator pauses an active task.

**Topics**

| Index | Type   | Value         |
| ----- | ------ | ------------- |
| 0     | Symbol | `"TaskPaused"` |
| 1     | u64    | `task_id`     |

**Data**

| Field     | Type    | Description                       |
| --------- | ------- | --------------------------------- |
| `creator` | Address | The task owner who paused the task |

**Use case:** Mark the task as inactive in your index. Keepers should stop scheduling execution for paused tasks.

---

### TaskResumed

Emitted when a task creator re-activates a paused task.

**Topics**

| Index | Type   | Value          |
| ----- | ------ | -------------- |
| 0     | Symbol | `"TaskResumed"` |
| 1     | u64    | `task_id`      |

**Data**

| Field     | Type    | Description                        |
| --------- | ------- | ---------------------------------- |
| `creator` | Address | The task owner who resumed the task |

**Use case:** Re-enable the task in your index and resume scheduling execution checks.

---

### TaskUpdated

Emitted when the task configuration is modified by the creator.

**Topics**

| Index | Type   | Value          |
| ----- | ------ | -------------- |
| 0     | Symbol | `"TaskUpdated"` |
| 1     | u64    | `task_id`      |

**Data**

| Field     | Type    | Description                         |
| --------- | ------- | ----------------------------------- |
| `creator` | Address | The task owner who updated the task |

**Use case:** Invalidate any cached task configuration in your index and re-fetch the updated `TaskConfig` from contract storage.

---

### TaskCancelled

Emitted when a task is permanently removed. Any remaining gas balance is refunded to the creator before this event fires.

**Topics**

| Index | Type   | Value            |
| ----- | ------ | ---------------- |
| 0     | Symbol | `"TaskCancelled"` |
| 1     | u64    | `task_id`        |

**Data**

| Field     | Type    | Description                           |
| --------- | ------- | ------------------------------------- |
| `creator` | Address | The task owner who cancelled the task |

**Use case:** Remove the task from your index entirely. The task no longer exists in contract storage after this event.

---

### KeeperPaid

Emitted inside `execute()` after a keeper successfully runs a task and receives their fee.

**Topics**

| Index | Type   | Value        |
| ----- | ------ | ------------ |
| 0     | Symbol | `"KeeperPaid"` |
| 1     | u64    | `task_id`    |

**Data**

| Field    | Type    | Description                               |
| -------- | ------- | ----------------------------------------- |
| `keeper` | Address | The keeper address that executed the task |
| `fee`    | i128    | Amount of gas tokens transferred to the keeper |

**Use case:** Track execution history, keeper earnings, and task run frequency. Update `last_run` timestamp in your index.

---

### GasDeposited

Emitted when a user deposits gas tokens to fund a task's execution balance.

**Topics**

| Index | Type   | Value           |
| ----- | ------ | --------------- |
| 0     | Symbol | `"GasDeposited"` |
| 1     | u64    | `task_id`       |

**Data**

| Field    | Type    | Description                         |
| -------- | ------- | ----------------------------------- |
| `from`   | Address | Address that made the deposit       |
| `amount` | i128    | Amount of tokens deposited          |

**Use case:** Update the task's tracked `gas_balance` in your index. Alert when a task's balance drops below a threshold.

---

### GasWithdrawn

Emitted when the task creator withdraws gas tokens from the task balance.

**Topics**

| Index | Type   | Value           |
| ----- | ------ | --------------- |
| 0     | Symbol | `"GasWithdrawn"` |
| 1     | u64    | `task_id`       |

**Data**

| Field     | Type    | Description                         |
| --------- | ------- | ----------------------------------- |
| `creator` | Address | Address that made the withdrawal    |
| `amount`  | i128    | Amount of tokens withdrawn          |

**Use case:** Update the task's tracked `gas_balance` in your index. If the balance reaches zero, the keeper will no longer be compensated.

---

## Subscribing to Events via Soroban RPC

Soroban exposes a `getEvents` RPC method that lets you query events by contract ID, ledger range, and topic filters.

### Install dependencies

```bash
npm install @stellar/stellar-sdk
```

### Fetch all SoroTask events from a ledger range

```javascript
import { SorobanRpc } from "@stellar/stellar-sdk";

const rpc = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const CONTRACT_ID = "YOUR_CONTRACT_ID";

async function fetchEvents(startLedger) {
  const response = await rpc.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
      },
    ],
  });

  for (const event of response.events) {
    const eventName = event.topic[0].value(); // e.g. "TaskRegistered"
    const taskId = event.topic[1].value();    // u64 task ID
    console.log(`Event: ${eventName} | Task ID: ${taskId}`);
    console.log("Data:", event.value);
  }
}
```

---

## Filtering Events

You can filter by specific topic values to narrow down results to a particular event type or task.

### Filter for a specific event type (e.g., only `KeeperPaid`)

```javascript
const response = await rpc.getEvents({
  startLedger,
  filters: [
    {
      type: "contract",
      contractIds: [CONTRACT_ID],
      topics: [
        ["AAAADwAAAAxLZWVwZXJQYWlk"], // base64-encoded XDR for Symbol "KeeperPaid"
      ],
    },
  ],
});
```

> **Tip:** Use `xdr.ScVal.scvSymbol("KeeperPaid").toXDR("base64")` to generate the correct filter value programmatically.

### Programmatic topic filter builder

```javascript
import { xdr } from "@stellar/stellar-sdk";

function symbolFilter(name) {
  return xdr.ScVal.scvSymbol(name).toXDR("base64");
}

const response = await rpc.getEvents({
  startLedger,
  filters: [
    {
      type: "contract",
      contractIds: [CONTRACT_ID],
      topics: [
        [symbolFilter("TaskRegistered")],
      ],
    },
  ],
});
```

### Filter by event type AND task ID

```javascript
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

const taskId = 42n; // BigInt for u64

const response = await rpc.getEvents({
  startLedger,
  filters: [
    {
      type: "contract",
      contractIds: [CONTRACT_ID],
      topics: [
        [
          symbolFilter("KeeperPaid"),
          nativeToScVal(taskId, { type: "u64" }).toXDR("base64"),
        ],
      ],
    },
  ],
});
```

---

## Indexing Strategies

### Strategy 1: Custom Polling Bot

Build a lightweight Node.js service that polls `getEvents` on an interval and maintains a local database.

**Architecture**

```
Soroban RPC
    │
    ▼
Polling loop (every N seconds)
    │
    ▼
Event parser & dispatcher
    │
    ├── TaskRegistered → INSERT into tasks table
    ├── TaskPaused     → UPDATE tasks SET is_active = false
    ├── TaskResumed    → UPDATE tasks SET is_active = true
    ├── TaskUpdated    → INVALIDATE cache, re-fetch TaskConfig
    ├── TaskCancelled  → DELETE from tasks table
    ├── KeeperPaid     → INSERT into executions table
    ├── GasDeposited   → UPDATE tasks SET gas_balance += amount
    └── GasWithdrawn   → UPDATE tasks SET gas_balance -= amount
```

**Minimal implementation**

```javascript
import { SorobanRpc, xdr } from "@stellar/stellar-sdk";

const rpc = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const CONTRACT_ID = "YOUR_CONTRACT_ID";

// In production, persist this so restarts don't re-process old events
let cursor = "now";

async function poll() {
  const response = await rpc.getEvents({
    startLedger: cursor === "now" ? undefined : cursor,
    filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
    limit: 200,
  });

  for (const event of response.events) {
    await handleEvent(event);
    cursor = event.pagingToken;
  }
}

async function handleEvent(event) {
  const name = event.topic[0].value();
  const taskId = Number(event.topic[1].value());

  switch (name) {
    case "TaskRegistered":
      console.log(`[+] Task ${taskId} registered`);
      // INSERT task into local DB
      break;
    case "TaskPaused":
      console.log(`[~] Task ${taskId} paused`);
      break;
    case "TaskResumed":
      console.log(`[~] Task ${taskId} resumed`);
      break;
    case "TaskUpdated":
      console.log(`[~] Task ${taskId} config updated`);
      break;
    case "TaskCancelled":
      console.log(`[-] Task ${taskId} cancelled`);
      break;
    case "KeeperPaid": {
      const [keeper, fee] = event.value.value();
      console.log(`[✓] Task ${taskId} executed by ${keeper}, fee: ${fee}`);
      break;
    }
    case "GasDeposited": {
      const [from, amount] = event.value.value();
      console.log(`[+] Task ${taskId} gas deposit: ${amount} from ${from}`);
      break;
    }
    case "GasWithdrawn": {
      const [creator, amount] = event.value.value();
      console.log(`[-] Task ${taskId} gas withdrawn: ${amount} by ${creator}`);
      break;
    }
  }
}

setInterval(poll, 6000); // Poll every 6 seconds (approx. 1 ledger)
```

**Pros**
- Full control over storage and logic
- No external dependencies beyond Soroban RPC
- Easy to extend with custom alerting

**Cons**
- You manage infrastructure, uptime, and re-indexing
- Must handle cursor persistence and missed events on restart

---

### Strategy 2: Managed Indexer Service

Use a third-party indexing platform that natively supports Soroban events.

**Options**

| Service       | Notes                                                     |
| ------------- | --------------------------------------------------------- |
| [Mercury](https://mercurydata.app) | Soroban-native indexer, supports topic subscriptions |
| [SubQuery](https://subquery.network) | General-purpose indexer with Soroban support |
| [Stellar Quest Indexer](https://quest.stellar.org) | Community-maintained, good for testnet |

**Example: Mercury subscription (pseudo-config)**

```json
{
  "contract_id": "YOUR_CONTRACT_ID",
  "topics": ["TaskRegistered", "KeeperPaid", "GasDeposited"],
  "webhook_url": "https://your-backend.example.com/sorotask-events"
}
```

Your backend then receives a POST for each matching event and processes it.

**Pros**
- No polling infrastructure to maintain
- Automatic historical backfill
- Low operational overhead

**Cons**
- Vendor dependency and potential cost
- Less control over query latency
- May not support all filter combinations

---

### Strategy 3: Keeper-Embedded Indexing

For smaller deployments, the keeper bot itself can maintain a lightweight in-memory or file-based index without a separate indexer service.

This is the approach used in the SoroTask reference keeper (`/keeper`). The keeper polls `monitor()` or `monitor_paginated()` directly and tracks which tasks it has seen, without relying on event history.

**When to use this approach**
- Local development or testnet
- Single-keeper deployments
- When you only need execution state, not full event history

**Limitation:** This approach does not reconstruct historical gas balance changes, pauses, or cancellations that occurred while the keeper was offline.

---

## Recommended Production Setup

For a production SoroTask integration, combine strategies:

```
┌─────────────────────────────────────────────────────────┐
│  Soroban RPC (Horizon + Soroban RPC endpoint)           │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │   Event Indexer Service  │  ← Strategy 1 or 2
              │  (polls getEvents loop)  │
              └────────────┬────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────▼─────┐   ┌──────▼──────┐  ┌─────▼──────┐
    │  Task DB  │   │ Keeper Bot  │  │  Dashboard │
    │(Postgres) │   │  /keeper    │  │  /frontend │
    └───────────┘   └─────────────┘  └────────────┘
```

1. **Index all 8 events** as described in this document to maintain a complete picture of task state.
2. **Persist your ledger cursor** between restarts to avoid re-processing or missing events.
3. **Re-fetch `TaskConfig`** from storage on `TaskUpdated` — the event only signals that a change occurred.
4. **Monitor `GasDeposited` / `GasWithdrawn`** to alert task owners when gas is running low before a keeper stops receiving fees.
5. **Use `KeeperPaid`** events to build execution history, keeper leaderboards, or fee analytics.
