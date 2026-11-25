# SoroTask Contract — Access Control Audit

**Audit date:** 2025  
**Contract:** `SoroTaskContract` (`contract/src/lib.rs`)  
**Soroban SDK version:** 25.3.1  
**Auditor:** Automated audit via `test_access_control.rs`

---

## 1. Privileged Function Table

| # | Function | Required Actor | Auth Mechanism | Notes |
|---|----------|---------------|----------------|-------|
| 1 | `init` | *(none)* | No `require_auth()` | Any caller can initialize an uninitialized contract — see §4 |
| 2 | `register` | `config.creator` | `config.creator.require_auth()` | Creator is supplied by the caller in the `TaskConfig` struct |
| 3 | `pause_task` | Task's `creator` | `config.creator.require_auth()` | Loaded from storage; panics if task not found |
| 4 | `resume_task` | Task's `creator` | `config.creator.require_auth()` | Loaded from storage; panics if task not found |
| 5 | `execute` | `keeper` (caller) + optional whitelist | `keeper.require_auth()` + whitelist check | See §2 for whitelist semantics |
| 6 | `deposit_gas` | `from` (caller-supplied) | `from.require_auth()` | Any address can deposit on behalf of itself |
| 7 | `withdraw_gas` | Task's `creator` | `config.creator.require_auth()` | Loaded from storage |
| 8 | `cancel_task` | Task's `creator` | `config.creator.require_auth()` | Loaded from storage; refunds gas on cancel |
| 9 | `add_dependency` | Task's `creator` | `task.creator.require_auth()` | Loaded from storage |
| 10 | `remove_dependency` | Task's `creator` | `task.creator.require_auth()` | Loaded from storage |
| 11 | `update_task` | Task's `creator` | `existing.creator.require_auth()` | Test-only helper; not a contract entrypoint — see §4 |

---

## 2. Whitelist Semantics for `execute`

The `execute` function enforces a two-level access check:

```
1. keeper.require_auth()          — the keeper must sign the transaction
2. if !whitelist.is_empty()       — if a whitelist is configured …
       && !whitelist.contains(keeper)
   → panic_with_error!(Unauthorized)
```

| Whitelist state | Behaviour |
|-----------------|-----------|
| **Empty** (`Vec::new`) | Any keeper who signs the transaction may execute the task |
| **Non-empty** | Only keepers whose address appears in the whitelist may execute |

**Implication:** An empty whitelist is the "open" mode — it does not restrict
execution to any particular keeper.  Task creators who want to restrict
execution to a trusted set of keepers must populate the whitelist at
registration time (or via `update_task`).

---

## 3. Ownership Lock in `update_task`

`update_task` (a test-only helper that mirrors the intended production
`update_task` entrypoint) explicitly locks three fields regardless of what the
caller supplies in `new_config`:

```rust
let updated = TaskConfig {
    creator:     existing.creator,      // locked — cannot transfer ownership
    gas_balance: existing.gas_balance,  // locked — use deposit_gas / withdraw_gas
    last_run:    existing.last_run,     // locked — would break interval logic
    ..new_config
};
```

This means:
- **Ownership cannot be transferred** via `update_task`.  Even if a caller
  supplies a different `creator` address in `new_config`, the stored value
  remains the original creator.
- **Gas balance cannot be manipulated** via `update_task`.  All gas changes
  must go through `deposit_gas` / `withdraw_gas`.
- **`last_run` cannot be reset** via `update_task`.  Resetting it would allow
  a task to execute before its interval has elapsed.

---

## 4. Ambiguities and Findings

### 4.1 `init` has no auth guard (MEDIUM)

**Observation:** `init` does not call `require_auth()` on any address.  Any
account on the network can call `init` on a freshly deployed, uninitialized
contract and set an arbitrary token address.

**Impact:** If an attacker front-runs the legitimate deployer's `init` call,
they can set a malicious token address.  All subsequent `deposit_gas`,
`withdraw_gas`, and `execute` (fee transfer) calls would interact with the
attacker-controlled token.

**Recommendation:** Add an admin/deployer address to the contract at deploy
time (e.g. via a constructor argument or a hard-coded constant) and require
`admin.require_auth()` inside `init`.  Alternatively, use Soroban's
`env.deployer().require_auth()` pattern.

### 4.2 `register` — creator is caller-supplied (LOW)

**Observation:** The `creator` field in `TaskConfig` is supplied by the caller,
not derived from the transaction signer.  The contract calls
`config.creator.require_auth()`, which means the caller must prove they control
the address they claim as creator.  This is correct Soroban auth practice, but
it means the creator address is not automatically the transaction source account.

**Impact:** No direct vulnerability, but maintainers should be aware that the
creator is the address that signed the `require_auth()` call, not necessarily
the transaction fee payer.

**Recommendation:** Document this clearly in the public API.  Consider
deriving the creator from `env.invoker()` if the intent is always "the
transaction signer is the creator".

### 4.3 `update_task` is not a contract entrypoint (INFO)

**Observation:** `update_task` is defined inside `#[cfg(test)] mod tests` with
`#[allow(dead_code)]`.  It is not exposed as a `#[contractimpl]` method and
therefore cannot be called on-chain.

**Impact:** No on-chain risk.  However, if a production `update_task`
entrypoint is added in the future, the ownership-lock logic must be preserved.

**Recommendation:** If `update_task` is intended for production use, move it
into the `#[contractimpl]` block and add it to the access control test suite.

### 4.4 `deposit_gas` — any address can deposit for any task (INFO)

**Observation:** `deposit_gas(task_id, from, amount)` requires `from.require_auth()`
but does not restrict which task the deposit targets.  Any address can top up
any task's gas balance.

**Impact:** No direct vulnerability — depositing gas is a beneficial action for
the task creator.  However, a griefing scenario is theoretically possible if
gas deposits trigger unintended side effects in future versions.

**Recommendation:** Document this as intentional open-deposit semantics.

### 4.5 Paused-task auth order (INFO)

**Observation:** In `pause_task` and `resume_task`, the task is loaded from
storage *before* `require_auth()` is called.  This means a call to a
non-existent task panics with "Task not found" before the auth check fires.

**Impact:** An attacker can probe for task existence without providing auth.
This is a minor information-disclosure issue.

**Recommendation:** Consider checking auth before loading the task, or
returning a generic error for non-existent tasks to avoid leaking existence
information.

---

## 5. Recommendations for Maintainers

1. **Add an auth guard to `init`** — require the deployer or a designated admin
   to sign the initialization call (see §4.1).

2. **Promote `update_task` to a contract entrypoint** if task mutation is
   needed on-chain, and ensure the ownership-lock logic is preserved (see §4.3).

3. **Document whitelist semantics** in the public API and SDK documentation —
   specifically that an empty whitelist means "open to all keepers" (see §2).

4. **Consider auth-before-load ordering** in `pause_task` / `resume_task` to
   avoid leaking task existence (see §4.5).

5. **Add a `get_token` guard** — `get_token` panics if the contract is not
   initialized.  Consider returning `Option<Address>` to allow callers to check
   initialization state without panicking.

6. **Maintain the access control test suite** — `test_access_control.rs`
   provides a regression baseline.  Any new privileged function must be added
   to this file with all three test categories (unauthorized, authorized,
   edge-case).

---

## 6. Test Coverage Summary

The following tests in `src/test_access_control.rs` cover the access control
surface:

| Test | Category | Function |
|------|----------|----------|
| `test_register_unauthorized_actor_rejected` | unauthorized | `register` |
| `test_register_authorized_actor_succeeds` | authorized | `register` |
| `test_register_edge_case_zero_interval` | edge case | `register` |
| `test_pause_task_unauthorized_actor_rejected` | unauthorized | `pause_task` |
| `test_pause_task_authorized_actor_succeeds` | authorized | `pause_task` |
| `test_pause_task_edge_case_already_paused` | edge case | `pause_task` |
| `test_resume_task_authorized_actor_succeeds` | authorized | `resume_task` |
| `test_resume_task_edge_case_already_active` | edge case | `resume_task` |
| `test_pause_resume_non_creator_rejected` | unauthorized | `pause_task` / `resume_task` |
| `test_execute_non_whitelisted_keeper_rejected` | unauthorized | `execute` |
| `test_execute_whitelisted_keeper_succeeds` | authorized | `execute` |
| `test_execute_empty_whitelist_allows_any_keeper` | edge case | `execute` |
| `test_execute_unauthorized_actor_rejected` | unauthorized | `execute` |
| `test_execute_edge_case_paused_task` | edge case | `execute` |
| `test_deposit_gas_authorized_actor_succeeds` | authorized | `deposit_gas` |
| `test_deposit_gas_unauthorized_actor_rejected` | unauthorized | `deposit_gas` |
| `test_deposit_gas_edge_case_nonexistent_task` | edge case | `deposit_gas` |
| `test_withdraw_gas_authorized_actor_succeeds` | authorized | `withdraw_gas` |
| `test_withdraw_gas_non_creator_rejected` | unauthorized | `withdraw_gas` |
| `test_withdraw_gas_edge_case_insufficient_balance` | edge case | `withdraw_gas` |
| `test_cancel_task_authorized_actor_succeeds` | authorized | `cancel_task` |
| `test_cancel_task_non_creator_rejected` | unauthorized | `cancel_task` |
| `test_cancel_task_edge_case_nonexistent_task` | edge case | `cancel_task` |
| `test_add_dependency_authorized_actor_succeeds` | authorized | `add_dependency` |
| `test_add_dependency_unauthorized_actor_rejected` | unauthorized | `add_dependency` |
| `test_add_dependency_edge_case_nonexistent_dependency` | edge case | `add_dependency` |
| `test_remove_dependency_authorized_actor_succeeds` | authorized | `remove_dependency` |
| `test_remove_dependency_unauthorized_actor_rejected` | unauthorized | `remove_dependency` |
| `test_remove_dependency_edge_case_not_present` | edge case | `remove_dependency` |
| `test_update_task_cannot_transfer_ownership` | authorized + edge case | `update_task` |
| `test_update_task_unauthorized_actor_rejected` | unauthorized | `update_task` |
| `test_init_can_only_be_called_once` | edge case | `init` |
| `test_init_authorized_actor_succeeds` | authorized | `init` |
| `test_init_no_auth_guard_any_caller_can_initialize` | ambiguity | `init` |

**Total: 34 access control tests, all passing.**
