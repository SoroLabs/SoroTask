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
    match env.try_invoke_contract::<Val, soroban_sdk::Error>(target, function, args) {
        Ok(Ok(val)) => Ok(val),
        // Target contract returned a contract-level error / reverted.
        Ok(Err(_contract_err)) => Err(TARGET_INVOKE_REJECTED),
        // Host/SDK invocation failure (missing contract, bad symbol, etc.).
        Err(_sdk_err) => Err(TARGET_INVOKE_SDK_ERROR),
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
        (
            symbol_short!("BatchTask"),
            status,
            keeper.clone(),
            task_id,
        ),
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
        (summary.total, summary.succeeded, summary.failed, summary.outcomes.clone()),
    );
}
