# Issue #1180: Zero-cost reentrancy guard

## Implementation

Added `contract/src/security.rs` with a `ReentrancyGuard` RAII type. Creating
the guard checks and sets a bit in the contract instance-storage lock; if the
bit is already set, construction reverts with `Error::ReentrantCall`. Dropping
the guard clears the bit. Soroban transaction rollback also reverts storage
changes when an invocation fails.

The existing lock helpers in `contract/src/lib.rs` now share this bitmask, so
existing protected operations continue to use the same contract-wide lock.
The guard is used for `execute`, `execute_with_vdf`, `flash_execute`,
`withdraw_gas`, and `cancel_task`. In particular, `flash_execute` takes the
lock before calling its callback contract.

## Validation

`cargo test test_malicious_target_cannot_reenter_cancel_task --lib` passed. The
test confirms the callback reentry is rejected, the victim task remains
registered, and a later ordinary execution succeeds. A missing test-only
`Ledger` trait import in `rate_limiter.rs` was added so the test crate could
compile.
