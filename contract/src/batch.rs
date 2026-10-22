//! Batch task execution with partial-failure isolation (#1179).
//!
//! `batch_execute` accepts a vector of task IDs, attempts each task through a
//! fallible path that uses `try_invoke_contract` for the target call, and
//! settles keeper fees only for successes. A failing target must not revert
//! sibling tasks in the same batch.
//!
//! Soroban panics inside the same contract invocation cannot be caught, so the
//! batch path avoids `panic_with_error!` for per-task outcomes: every recoverable
//! failure is recorded in a [`BatchTaskOutcome`] and execution continues.

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol, Val, Vec};

use crate::{Error, TaskConfig};

/// Maximum number of tasks accepted in one batch execution.
pub const MAX_BATCH_EXECUTION_TASKS: u32 = 100;

/// One task's result inside a batch.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchTaskOutcome {
    pub task_id: u64,
    pub succeeded: bool,
    /// `0` on success; otherwise a `crate::Error` discriminant.
    pub error_code: u32,
}

/// Aggregate receipt returned by `batch_execute`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchExecutionSummary {
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub outcomes: Vec<BatchTaskOutcome>,
}

/// Load a task or map the miss to `Error::TaskNotFound`.
pub(crate) fn load_task_or_error(env: &Env, task_id: u64) -> Result<TaskConfig, Error> {
    match crate::load_task(env, task_id) {
        Some(cfg) => Ok(cfg),
        None => Err(Error::TaskNotFound),
    }
}

/// Sentinel codes for target-call failures when the SDK does not expose a
/// numeric contract error (acceptance: non-zero code ⇒ task failed).
pub(crate) const TARGET_INVOKE_REJECTED: u32 = 0xFFFF;
pub(crate) const TARGET_INVOKE_SDK_ERROR: u32 = 0xFFFE;

/// Sentinel code indicating that a task in an atomic pair was rolled back
/// because its paired partner failed (#1415).
pub const ATOMIC_PAIR_PARTNER_FAILED: u32 = 0xFFFD;

/// Maximum number of atomic pairs permitted in a single batch dispatch (#1415).
pub const MAX_BATCH_PAIRS: u32 = 25;

/// Paired tasks that must execute atomically together in a batch dispatch (#1415).
///
/// If either task fails preconditions or its target invocation reverts,
/// neither task commits in contract storage and both are recorded as
/// failed/rolled back in the batch outcomes.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AtomicTaskPair {
    pub task_a: u64,
    pub task_b: u64,
}

/// Invoke `target::function(args)` without panicking the caller.
///
/// Returns `Ok` when the target contract call succeeds and `Err` with a
/// non-zero code otherwise, so batch siblings can continue.
pub(crate) fn try_invoke_target(
    env: &Env,
    target: &Address,
    function: &Symbol,
    args: Vec<Val>,
) -> Result<Val, u32> {
    match crate::security::try_invoke_contract_with_guard::<Val>(
        env,
        target,
        function,
        args,
        false, // target call is state-changing
    ) {
        Ok(val) => Ok(val),
        Err(_) => Err(TARGET_INVOKE_REJECTED),
    }
}

/// Emit a structured per-task status event.
pub(crate) fn publish_batch_task_event(
    env: &Env,
    keeper: &Address,
    task_id: u64,
    succeeded: bool,
    error_code: u32,
) {
    let status: Symbol = if succeeded {
        symbol_short!("SUCCESS")
    } else {
        symbol_short!("FAILED")
    };
    env.events().publish(
        (symbol_short!("BatchTask"), status, keeper.clone(), task_id),
        error_code,
    );
}

/// Emit the aggregate batch receipt.
pub(crate) fn publish_batch_summary_event(
    env: &Env,
    keeper: &Address,
    summary: &BatchExecutionSummary,
) {
    env.events().publish(
        (
            symbol_short!("BatchExec"),
            symbol_short!("SUMMARY"),
            keeper.clone(),
        ),
        (
            summary.total,
            summary.succeeded,
            summary.failed,
            summary.outcomes.clone(),
        ),
    );
}
