# Re-entrancy Guard Analysis - `execute()`

## Overview

`execute()` calls a user-defined `target` contract via `env.invoke_contract`
(`config.target`, arbitrary and controlled by whoever registered the task),
and optionally an equally arbitrary DeFi `protocol_address` via
`execute_yield_strategy` when a task has a `yield_strategy` configured. Any
function that hands control to an address it doesn't control is a
re-entrancy candidate: that external contract's code can call back into
`SoroTaskContract` before the original call finishes.

This document analyzes `execute`/`execute_internal` for that risk, explains
why the existing guard mechanism is the right mitigation (rather than
reordering state writes), and records a real bug in how that guard was
applied that this review found and fixed.

**Status: Reviewed. Guard mechanism confirmed necessary and sufficient;
one incorrect application of it fixed (see below).**

## 1. Is the code checks-effects-interactions ordered?

No, and that matters for this analysis. In `execute_internal`
(`contract/src/lib.rs`), the cross-contract call happens **before** the
state update:

```rust
// ── Cross-contract call ──────────────────────────────
if !executed_yield_strategy {
    env.invoke_contract::<Val>(&config.target, &config.function, config.args.clone());
}

// ── Payment to keeper & balance deduction ────────────
config.gas_balance -= fee;
// ... token transfer to keeper ...

// ── State update ─────────────────────────────────────
config.last_run = env.ledger().timestamp();
env.storage().persistent().set(&task_key, &config);
```

If `config.target`'s function called back into `execute()` for the same
`task_id` *before* `last_run` is persisted, the interval check
(`env.ledger().timestamp() < config.last_run + config.interval`) would still
see the **old** `last_run` and allow it through - the task could be executed
multiple times per interval, and (with a real gas token) the keeper fee
transferred multiple times per external call, off a single triggering
transaction.

**This is a real gap in the code's ordering.** It is not, on its own, safe
by construction - it relies entirely on the guard described below.

## 2. Why the guard mechanism closes the gap

`enter_security_guard`/`exit_security_guard` (`contract/src/lib.rs`) implement
a single, contract-wide mutex using **temporary storage** (not persistent -
appropriate, since the lock only needs to live for the duration of one
top-level invocation and temporary entries expire, rather than needing
explicit cleanup semantics across ledger closes):

```rust
fn enter_security_guard(env: &Env) {
    let key = DataKey::ReentrancyLock;
    if env.storage().temporary().has(&key) {
        panic!("Reentrancy guard triggered");
    }
    env.storage().temporary().set(&key, &true);
}
```

`execute()` acquires this lock before calling `execute_internal`, and
releases it after. Because the lock is a single flag shared across **every**
guarded entry point (`register`, `execute`, `init`, `init_proxy`,
`upgrade_contract`, `deposit_gas`/`withdraw_gas`, `execute_yield_strategy`,
etc. - grep `enter_security_guard` for the current list), any external call
that tries to call back into *any* of them while `execute()` is still
running hits the lock and panics, unwinding the entire transaction. This is
coarser than a per-task or per-function lock, but that's the point: it
doesn't matter whether the callback targets `execute` again, `register`, or
anything else - all of them are closed off for the duration.

The existing unit test `test_reentrant_state_mutation_is_rejected`
(`contract/src/lib.rs`) already covers the case of a malicious target
contract calling back into a *different* guarded function (`pause_task`)
mid-`execute`, and confirms the call reverts and no state changed (task
stays active, `last_run` stays 0).

**Conclusion: a guard mechanism is necessary (the checks-effects-interactions
ordering alone is not safe), and the existing global mutex is sufficient -
it does not need to be more granular, because closing off *all* re-entry
during a guarded call is strictly stronger than closing off only same-function
re-entry.**

## 3. Bug found: the guard was applied to an internal call, not just entry points

While tracing every guarded call path for this review, `execute_internal`'s
yield-strategy branch was calling the **public, guarded** entry point:

```rust
let executed_yield_strategy = if let Some(ref yield_strategy_id) = config.yield_strategy {
    Self::execute_yield_strategy(env.clone(), *yield_strategy_id, task_id) // guarded fn
        .expect("Yield strategy execution failed");
    true
} ...
```

`execute()` already holds the lock at this point. Calling the guarded
`execute_yield_strategy` (which itself calls `enter_security_guard`) is
**legitimate internal composition, not an external re-entrant call** - but
`enter_security_guard` can't tell the difference between "the contract
calling its own guarded logic" and "an attacker's contract calling back in."
It saw the lock already held and panicked every time, meaning **any task
with a `yield_strategy` configured could never execute successfully** - this
had zero test coverage before this review (no existing test ever set
`yield_strategy: Some(_)` and called `execute()`), so it went unnoticed.

**Fix:** extracted the guard-free core into a private
`execute_yield_strategy_internal`, mirroring the existing
`execute`/`execute_internal` split. The public `execute_yield_strategy`
(a real standalone entry point keepers/admin tooling can call directly)
still acquires the guard itself; `execute_internal` now calls the internal
helper directly, so it participates in the *same* lock `execute()` already
holds instead of trying to acquire a second one.

Regression test:
`tests::test_execute_with_yield_strategy_does_not_trip_reentrancy_guard`
(`contract/src/lib.rs`) registers a task with a `yield_strategy`, executes
it through the public `execute()` entry point end-to-end (including the
real keeper fee payment), and asserts it succeeds instead of panicking.

## 4. Recommendations for future guarded functions

- **Never call a guarded public function (one that itself calls
  `enter_security_guard`) from inside another guarded function's body.**
  If the logic needs to be shared, factor out a private `_internal` helper
  that takes `&Env` and skips the guard, the same way `execute`/
  `execute_internal` and `execute_yield_strategy`/
  `execute_yield_strategy_internal` are now both structured.
- When adding a new function that calls into an arbitrary,
  caller-supplied address (a new "target"-style parameter), assume it is
  hostile and wrap the public entry point in `enter_security_guard`/
  `exit_security_guard` rather than relying on manually re-ordering state
  writes - as shown in §1, this codebase does not consistently write state
  before external calls, so the guard is the actual safety net, not the
  ordering.
- Add a test that exercises the new function's guarded path end-to-end
  (not just in isolation) before considering it covered - the bug in §3
  existed specifically because the composed path (`execute` calling into
  yield-strategy logic) was never exercised by a test, even though each
  function individually had coverage.
