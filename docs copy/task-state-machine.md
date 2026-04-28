# Task State Machine & Lifecycle

This document formally describes the lifecycle of a **Task** in the SoroTask platform — every state it can be in, what triggers each transition, and which layer (on-chain contract vs. off-chain keeper) owns that transition.

---

## States

| State | Description |
|---|---|
| **Registered** | Task created on-chain. `is_active = true`, `last_run = 0`. |
| **Pending** | Task is active but interval has not elapsed. Not eligible for execution. |
| **Due** | `current_timestamp >= last_run + interval`. Keeper detects this and queues execution. |
| **Executing** | Keeper submitted the `execute` transaction. Awaiting on-chain confirmation. |
| **Executed** | Transaction confirmed SUCCESS. `last_run` updated. Task returns to Pending. |
| **Skipped** | Resolver returned `false`, or interval check failed inside the contract. `last_run` NOT updated. |
| **Paused** | Creator called `pause_task`. `is_active = false`. Keeper ignores this task. |
| **Resumed** | Creator called `resume_task`. `is_active = true`. Task re-enters Pending. |
| **Cancelled** | Creator called `cancel_task`. Task removed from storage. Gas refunded. Terminal state. |
| **InsufficientGas** | `gas_balance < 100` at execution time. Contract panics. Task stays Due until gas is topped up. |

---

## State Diagram

```
  register(config)  [on-chain]
  ─────────────────────────────────────────────────────────────────
  • creator.require_auth()
  • interval > 0 validated
  • is_active = true, last_run = 0
  • Emits: TaskRegistered(task_id, creator)
                          │
                          ▼
                 ┌─────────────────┐
                 │   REGISTERED    │
                 │  is_active=true │
                 │   last_run=0    │
                 └────────┬────────┘
                          │
              Time passes (off-chain keeper poll)
                          │
                          ▼
                 ┌─────────────────┐
          ┌─────►│    PENDING      │◄──────────────────────────────┐
          │      │ current_time    │                               │
          │      │ < last_run +    │                               │
          │      │   interval      │                               │
          │      └────────┬────────┘                               │
          │               │                                        │
          │   Interval elapses — keeper: current_time >= last_run + interval
          │               │                                        │
          │               ▼                                        │
          │      ┌─────────────────┐                              │
          │      │      DUE        │                              │
          │      │ Keeper detects  │                              │
          │      │ & enqueues      │                              │
          │      └────────┬────────┘                              │
          │               │                                        │
          │   Keeper submits execute(keeper, task_id) [on-chain]  │
          │               │                                        │
          │               ▼                                        │
          │      ┌─────────────────┐                              │
          │      │   EXECUTING     │                              │
          │      │ tx submitted,   │                              │
          │      │ awaiting        │                              │
          │      │ confirmation    │                              │
          │      └────────┬────────┘                              │
          │               │                                        │
          │    ┌──────────┼──────────────┐                        │
          │    ▼          ▼              ▼                        │
          │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐
          │  │   EXECUTED   │  │   SKIPPED    │  │  INSUFFICIENT_GAS  │
          │  │ tx SUCCESS   │  │ resolver=false│  │  gas_balance < 100 │
          │  │ last_run set │  │ OR too early │  │  contract panics   │
          │  │ KeeperPaid   │  │ last_run     │  │  tx FAILED         │
          │  │ event emitted│  │ unchanged    │  └────────┬───────────┘
          │  └──────┬───────┘  └──────┬───────┘           │
          │         │                 │          deposit_gas() restores balance
          │         └─────────────────┴───────────────────►┘
          │                           │
          └───────────────────────────┘
                  Returns to PENDING


  ─────────────────────────────────────────────────────────────────
  CREATOR-CONTROLLED TRANSITIONS  (all require creator.require_auth())
  ─────────────────────────────────────────────────────────────────

  Any active state (PENDING / DUE)
          │
          │  pause_task(task_id)
          │  • is_active = false
          │  • Emits: TaskPaused(task_id, creator)
          ▼
  ┌───────────────┐
  │    PAUSED     │
  │ is_active=false│
  │ Keeper ignores│
  └───────┬───────┘
          │
          │  resume_task(task_id)
          │  • is_active = true
          │  • Emits: TaskResumed(task_id, creator)
          ▼
  ┌───────────────┐
  │   RESUMED     │──► PENDING (re-enters normal lifecycle)
  └───────────────┘

  Any state (except CANCELLED)
          │
          │  cancel_task(task_id)
          │  • Refunds gas_balance to creator
          │  • Removes task from persistent storage
          │  • Emits: TaskCancelled(task_id, creator)
          ▼
  ┌───────────────┐
  │  CANCELLED    │  ← Terminal. Task no longer exists in storage.
  └───────────────┘
```

---

## Transition Table

| From | To | Trigger | Layer | Function / Action |
|---|---|---|---|---|
| — | Registered | Creator submits task config | On-chain | `register(config)` |
| Registered | Pending | Time passes, interval not elapsed | Off-chain | Keeper poll cycle |
| Pending | Due | `current_time >= last_run + interval` | Off-chain | `TaskPoller.checkTask()` |
| Due | Executing | Keeper submits transaction | Off-chain → On-chain | `executeTask()` → `execute(keeper, task_id)` |
| Executing | Executed | Tx SUCCESS, resolver approved, gas sufficient | On-chain | `execute()` updates `last_run`, emits `KeeperPaid` |
| Executing | Skipped | Resolver returned `false` | On-chain | `execute()` — `should_execute = false`, no state write |
| Executing | Skipped | `current_time < last_run + interval` (race) | On-chain | `execute()` returns early |
| Executing | InsufficientGas | `gas_balance < 100` | On-chain | `execute()` panics with `InsufficientBalance` |
| Executed | Pending | `last_run` updated, interval resets | On-chain | Automatic after successful execution |
| Skipped | Due | Next keeper cycle, condition unchanged | Off-chain | Keeper poll cycle |
| InsufficientGas | Due | Creator deposits gas | On-chain | `deposit_gas(task_id, from, amount)` |
| Any active | Paused | Creator calls pause | On-chain | `pause_task(task_id)` |
| Paused | Pending | Creator calls resume | On-chain | `resume_task(task_id)` |
| Any (except Cancelled) | Cancelled | Creator calls cancel | On-chain | `cancel_task(task_id)` |

---

## On-Chain vs. Off-Chain Responsibilities

### On-Chain (Soroban Contract — `contract/src/lib.rs`)

The contract is the source of truth. All invariants are enforced atomically.

**`register(config)`**
- Validates `interval > 0`
- Assigns sequential `task_id` via a persistent counter
- Sets `is_active = true`, `last_run = 0`
- Emits `TaskRegistered`

**`execute(keeper, task_id)`** — the core state transition function:
1. `keeper.require_auth()` — keeper must sign the transaction
2. Loads `TaskConfig` from persistent storage
3. Checks `is_active` — panics with `TaskPaused` if false
4. Checks whitelist — panics with `Unauthorized` if keeper not allowed
5. Checks interval — returns early (no error, no state change) if too soon
6. Resolver gate — calls `check_condition(args) -> bool` via `try_invoke_contract`. A failing resolver degrades gracefully to `false`
7. Checks `gas_balance >= 100` — panics with `InsufficientBalance` if not
8. Calls `target::function(args)` via `invoke_contract`
9. Deducts fee, transfers to keeper (if token initialized), updates `last_run`
10. Emits `KeeperPaid`

> Soroban transactions are fully atomic. If the target contract panics, the entire transaction reverts — `last_run` is never left in a half-updated state.

**`pause_task` / `resume_task`**
- Require `creator.require_auth()`
- Guard against idempotent calls (`TaskAlreadyPaused`, `TaskAlreadyActive`)

**`cancel_task`**
- Requires `creator.require_auth()`
- Refunds full `gas_balance` via token transfer (if token initialized)
- Removes task from persistent storage — irreversible

**`deposit_gas` / `withdraw_gas`**
- Transfer tokens between creator and contract
- Update `gas_balance` accounting

---

### Off-Chain (Keeper — `keeper/`)

The keeper is a stateless polling daemon. It cannot change task state directly — it only submits transactions that the contract validates.

**`registry.js` — Task Discovery**
- Subscribes to `TaskRegistered` on-chain events via `server.getEvents()`
- Persists known task IDs to `data/tasks.json` to survive restarts
- Polls for new events on every cycle

**`poller.js` — Due Detection**
- Fetches current ledger sequence via `server.getLatestLedger()`
- Calls `get_task(task_id)` for each known task using `simulateTransaction` (free, no fees consumed)
- Computes `last_run + interval <= current_timestamp`
- Pre-flight skips tasks with `gas_balance <= 0` before submitting

**`executor.js` — Execution**
- Builds, simulates, signs, and submits `execute(keeper, task_id)`
- Polls `getTransaction(hash)` until `SUCCESS`, `FAILED`, or `TIMEOUT`
- Retries transient failures with exponential backoff (`retry.js`)

**`queue.js` — Concurrency**
- Controls parallel execution slots (`MAX_CONCURRENT_EXECUTIONS`)
- Emits `task:success` / `task:failed` events for observability

---

## Events Reference

| Event | Emitted By | Payload |
|---|---|---|
| `TaskRegistered(task_id)` | `register()` | `creator: Address` |
| `KeeperPaid(task_id)` | `execute()` | `(keeper: Address, fee: i128)` |
| `TaskPaused(task_id)` | `pause_task()` | `creator: Address` |
| `TaskResumed(task_id)` | `resume_task()` | `creator: Address` |
| `TaskCancelled(task_id)` | `cancel_task()` | `creator: Address` |
| `GasDeposited(task_id)` | `deposit_gas()` | `(from: Address, amount: i128)` |
| `GasWithdrawn(task_id)` | `withdraw_gas()` | `(creator: Address, amount: i128)` |

The keeper's `TaskRegistry` subscribes to `TaskRegistered` to auto-discover new tasks without manual configuration.

---

## Gas & the InsufficientGas State

Every execution deducts a fixed fee of **100 units** from `gas_balance`. The contract enforces this before the cross-contract call:

```rust
let fee: i128 = 100;
if config.gas_balance < fee {
    panic_with_error!(&env, Error::InsufficientBalance);
}
```

The keeper also pre-screens in `poller.js` (`gas_balance <= 0`) to avoid submitting a transaction that will certainly fail. Note: a task with `gas_balance` between 1–99 passes the keeper pre-flight but fails on-chain — the contract check is authoritative.

To recover, the creator calls `deposit_gas(task_id, from, amount)`. The task becomes eligible again on the next keeper cycle.
