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

use soroban_sdk::{contracttype, symbol_short, Address, Bytes, BytesN, Env, Symbol, Val, Vec};

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
        env, target, function, args, false, // target call is state-changing
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

// ============================================================================
// ZK-Rollup state-transition aggregation (SC-FINAL-43)
// ============================================================================
//
// Keepers run high-frequency tasks off-chain and settle them in batches of up
// to [`MAX_ROLLUP_BATCH_TASKS`]. Each task in a batch contributes one
// [`RollupTaskTransition`]: its pre-state and post-state commitments inside the
// L2 state tree plus the number of micro-executions it went through.
//
// The transitions are folded into one binary Merkle root (the
// *transitions root*). That root is one of the values the recursive SNARK
// commits to (see `zk::rollup_batch_commitment`), so the proof cannot be
// reused for a different set of transitions, and anyone can later prove that a
// task was settled in a given batch with `verify_rollup_inclusion`.
//
// Hashing is domain-separated so a leaf can never be passed off as an
// internal node (second-preimage protection):
//
//   leaf = SHA-256(0x00 || task_id_be8 || pre_state || post_state || executions_be4)
//   node = SHA-256(0x01 || left || right)
//
// When a level has an odd number of nodes, the last node is carried up to the
// next level unchanged instead of being paired with itself. Duplicating it
// would make `[a, b, c]` and `[a, b, c, c]` hash to the same root.

/// Maximum number of task transitions settled by one rollup batch.
pub const MAX_ROLLUP_BATCH_TASKS: u32 = 100;

/// Domain tag for transition leaves.
pub const ROLLUP_LEAF_TAG: u8 = 0x00;

/// Domain tag for internal Merkle nodes.
pub const ROLLUP_NODE_TAG: u8 = 0x01;

/// One task's state change, executed off-chain and settled in a rollup batch.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RollupTaskTransition {
    /// On-chain task ID.
    pub task_id: u64,
    /// The task's leaf in the L2 state tree before the batch.
    pub pre_state: BytesN<32>,
    /// The task's leaf in the L2 state tree after the batch.
    pub post_state: BytesN<32>,
    /// Number of off-chain micro-executions folded into this transition.
    pub executions: u32,
}

/// What the contract derives from a batch's transitions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RollupAggregate {
    /// Merkle root over the transition leaves, in submission order.
    pub transitions_root: BytesN<32>,
    /// Number of transitions.
    pub task_count: u32,
    /// Sum of `executions` across all transitions.
    pub total_executions: u64,
}

/// Hash one transition into its Merkle leaf.
pub fn rollup_leaf_hash(env: &Env, transition: &RollupTaskTransition) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.push_back(ROLLUP_LEAF_TAG);
    buf.extend_from_array(&transition.task_id.to_be_bytes());
    buf.extend_from_array(&transition.pre_state.to_array());
    buf.extend_from_array(&transition.post_state.to_array());
    buf.extend_from_array(&transition.executions.to_be_bytes());
    env.crypto().sha256(&buf).into()
}

/// Hash two child nodes into their parent.
pub fn rollup_node_hash(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.push_back(ROLLUP_NODE_TAG);
    buf.extend_from_array(&left.to_array());
    buf.extend_from_array(&right.to_array());
    env.crypto().sha256(&buf).into()
}

/// Fold a non-empty list of leaves into a Merkle root.
///
/// The caller must pass at least one leaf.
pub fn rollup_merkle_root(env: &Env, leaves: &Vec<BytesN<32>>) -> BytesN<32> {
    let mut level = leaves.clone();
    while level.len() > 1 {
        let mut next: Vec<BytesN<32>> = Vec::new(env);
        let mut i = 0u32;
        while i < level.len() {
            if i + 1 < level.len() {
                next.push_back(rollup_node_hash(
                    env,
                    &level.get_unchecked(i),
                    &level.get_unchecked(i + 1),
                ));
            } else {
                // Odd node out: carry it up unchanged.
                next.push_back(level.get_unchecked(i));
            }
            i += 2;
        }
        level = next;
    }
    level.get_unchecked(0)
}

/// Validate a batch of transitions and fold them into a [`RollupAggregate`].
///
/// Rejects the batch when:
/// - it is empty or holds more than [`MAX_ROLLUP_BATCH_TASKS`] transitions
///   (`Error::RollupInvalidBatchSize`);
/// - task IDs are not strictly increasing, which also rules out a task
///   appearing twice in one batch (`Error::RollupUnorderedTransitions`);
/// - a transition reports zero executions (`Error::RollupInvalidTransition`).
pub fn aggregate_rollup_transitions(
    env: &Env,
    transitions: &Vec<RollupTaskTransition>,
) -> Result<RollupAggregate, Error> {
    let count = transitions.len();
    if count == 0 || count > MAX_ROLLUP_BATCH_TASKS {
        return Err(Error::RollupInvalidBatchSize);
    }

    let mut leaves: Vec<BytesN<32>> = Vec::new(env);
    let mut total_executions: u64 = 0;
    let mut prev_task_id: Option<u64> = None;

    for transition in transitions.iter() {
        if let Some(prev) = prev_task_id {
            if transition.task_id <= prev {
                return Err(Error::RollupUnorderedTransitions);
            }
        }
        if transition.executions == 0 {
            return Err(Error::RollupInvalidTransition);
        }
        prev_task_id = Some(transition.task_id);
        total_executions += transition.executions as u64;
        leaves.push_back(rollup_leaf_hash(env, &transition));
    }

    Ok(RollupAggregate {
        transitions_root: rollup_merkle_root(env, &leaves),
        task_count: count,
        total_executions,
    })
}

/// Check that `leaf` sits at `index` in a tree of `leaf_count` leaves whose
/// root is `root`.
///
/// `siblings` lists the sibling hashes from the leaf level upwards. Levels
/// where the node on the path is the carried-up odd node have no sibling and
/// take no entry in the list. Any leftover or missing sibling makes the proof
/// invalid.
pub fn verify_rollup_inclusion(
    env: &Env,
    root: &BytesN<32>,
    leaf: &BytesN<32>,
    index: u32,
    leaf_count: u32,
    siblings: &Vec<BytesN<32>>,
) -> bool {
    if leaf_count == 0 || index >= leaf_count {
        return false;
    }

    let mut node = leaf.clone();
    let mut idx = index;
    let mut width = leaf_count;
    let mut used = 0u32;

    while width > 1 {
        let is_carried = idx == width - 1 && width % 2 == 1;
        if !is_carried {
            if used >= siblings.len() {
                return false;
            }
            let sibling = siblings.get_unchecked(used);
            used += 1;
            node = if idx % 2 == 0 {
                rollup_node_hash(env, &node, &sibling)
            } else {
                rollup_node_hash(env, &sibling, &node)
            };
        }
        idx /= 2;
        width = width.div_ceil(2);
    }

    used == siblings.len() && &node == root
}
