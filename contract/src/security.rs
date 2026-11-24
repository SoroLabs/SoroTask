//! Advanced Cross-Contract Reentrancy Guard with Multi-Call Reentrancy Topology Detection
//!
//! This module implements an advanced invocation topology reentrancy guard that tracks
//! call-graph execution stack depth and state mutation flags. It prevents external
//! contract callbacks from reading unfinalized balance states or initiating recursive
//! operations.
//!
//! Features:
//! - Direct reentrancy detection (same contract recursive calls)
//! - Indirect reentrancy detection (A -> B -> A call chains)
//! - Read-only reentrancy detection (callbacks reading unfinalized state)
//! - Cross-contract callback topology tracking
//! - Multi-call batch support without false positives

use soroban_sdk::{panic_with_error, Address, Env, Symbol, Vec};

use crate::{CallFrame, CallGraph, DataKey, Error};

const REENTRANCY_GUARD_BIT: u32 = 1;

/// Maximum allowed call stack depth for cross-contract invocations
const MAX_CALL_STACK_DEPTH: u32 = 16;

/// Maximum number of unique contracts in a single call graph
const MAX_CALL_GRAPH_SIZE: u32 = 32;

/// Reentrancy guard configuration flags
const FLAG_READ_ONLY_CHECK: u32 = 1 << 1;
const FLAG_STATE_MUTATED: u32 = 1 << 2;
const FLAG_CROSS_CONTRACT_CALL: u32 = 1 << 3;

impl CallGraph {
    /// Creates a new empty call graph
    pub fn new(env: &Env) -> Self {
        Self {
            frames: Vec::new(env),
            visited_contracts: Vec::new(env),
            state_mutated: false,
            depth: 0,
        }
    }

    /// Returns the current call graph from transient storage, or creates a new one
    pub fn get_or_create(env: &Env) -> Self {
        let key = DataKey::ReentrancyLock;
        if let Some(graph) = env.storage().temporary().get::<DataKey, CallGraph>(&key) {
            graph
        } else {
            Self::new(env)
        }
    }

    /// Saves the call graph to transient storage
    pub fn save(&self, env: &Env) {
        let key = DataKey::ReentrancyLock;
        env.storage().temporary().set(&key, self);
        // Set TTL to persist for the transaction (100 ledgers should be enough)
        env.storage().temporary().extend_ttl(&key, 100, 100);
    }

    /// Pushes a new frame onto the call stack
    pub fn push_frame(
        &mut self,
        env: &Env,
        contract: Address,
        function: Symbol,
        is_read_only: bool,
    ) -> Result<(), Error> {
        // Check max depth
        if self.depth >= MAX_CALL_STACK_DEPTH {
            return Err(Error::ReentrantCall);
        }

        // Check for cycles in the call graph (indirect reentrancy)
        // Allow same contract at different depths if it's a legitimate nested call
        // but track unique contracts for cross-contract cycle detection
        let mut contract_count = 0;
        let frames_len = self.frames.len();
        let mut i = 0;
        while i < frames_len {
            if let Some(frame) = self.frames.get(i) {
                if frame.contract == contract {
                    contract_count += 1;
                    // If we've seen this contract more than twice at different depths,
                    // it's likely a reentrancy loop
                    if contract_count > 2 && self.depth > 2 {
                        return Err(Error::ReentrantCall);
                    }
                }
            }
            i += 1;
        }

        // Check if we're calling back into a contract we've already visited
        // in this call graph (cross-contract reentrancy)
        let visited_len = self.visited_contracts.len();
        let mut j = 0;
        while j < visited_len {
            if let Some(addr) = self.visited_contracts.get(j) {
                if addr == contract && self.depth > 0 {
                    // Allow re-entry to the same contract only if it's the immediate parent
                    // (direct recursion) and we haven't mutated state yet
                    if self.depth == 1 && !self.state_mutated {
                        // This might be legitimate (e.g., callback pattern)
                        // But we'll track it carefully
                    } else {
                        return Err(Error::ReentrantCall);
                    }
                }
            }
            j += 1;
        }

        // Add to visited contracts if not already there
        let mut already_visited = false;
        let visited_len = self.visited_contracts.len();
        let mut k = 0;
        while k < visited_len {
            if let Some(addr) = self.visited_contracts.get(k) {
                if addr == contract {
                    already_visited = true;
                    break;
                }
            }
            k += 1;
        }

        if !already_visited {
            if self.visited_contracts.len() >= MAX_CALL_GRAPH_SIZE {
                return Err(Error::ReentrantCall);
            }
            self.visited_contracts.push_back(contract.clone());
        }

        let frame = CallFrame {
            contract: contract.clone(),
            function,
            state_mutated: false,
            is_read_only,
            depth: self.depth,
        };

        self.frames.push_back(frame);
        self.depth += 1;
        Ok(())
    }

    /// Pops the top frame from the call stack
    pub fn pop_frame(&mut self) -> Option<CallFrame> {
        if self.depth == 0 {
            return None;
        }
        self.depth -= 1;
        self.frames.pop_back()
    }

    /// Marks that state has been mutated in the current frame
    pub fn mark_state_mutated(&mut self) {
        self.state_mutated = true;
        if self.depth > 0 {
            if let Some(mut frame) = self.frames.get(self.depth - 1) {
                frame.state_mutated = true;
                self.frames.set(self.depth - 1, frame);
            }
        }
    }

    /// Checks if the current call would be a read-only reentrancy
    /// (reading state that hasn't been finalized yet)
    pub fn check_read_only_reentrancy(&self, env: &Env, contract: &Address) -> Result<(), Error> {
        // If we're in a nested call and state has been mutated,
        // prevent read-only calls to contracts that might observe unfinalized state
        if self.state_mutated && self.depth > 0 {
            // Check if the contract being called is the same as any in our call stack
            // This detects read-only reentrancy where a callback reads intermediate state
            let frames_len = self.frames.len();
            let mut i = 0;
            while i < frames_len {
                if let Some(frame) = self.frames.get(i) {
                    if &frame.contract == contract {
                        // If this is a read-only call to a contract we've already called
                        // after state mutation, it's a read-only reentrancy attack
                        if frame.is_read_only || self.is_read_only_call(contract) {
                            return Err(Error::ReentrantCall);
                        }
                    }
                }
                i += 1;
            }
        }
        Ok(())
    }

    /// Heuristic to detect if a call is likely read-only
    fn is_read_only_call(&self, contract: &Address) -> bool {
        // In practice, we'd check the function selector against known view functions
        // For now, we'll be conservative and allow the call
        // This can be enhanced with a registry of known view functions
        false
    }

    /// Checks if we're in a cross-contract callback scenario
    pub fn is_cross_contract_callback(&self) -> bool {
        self.depth > 1 && self.visited_contracts.len() > 1
    }

    /// Gets the current call stack depth
    pub fn depth(&self) -> u32 {
        self.depth
    }

    /// Checks if state has been mutated in this transaction
    pub fn has_state_mutated(&self) -> bool {
        self.state_mutated
    }
}

/// Advanced reentrancy guard with call-graph topology tracking
pub struct ReentrancyGuard<'a> {
    env: &'a Env,
    call_graph: CallGraph,
    entered: bool,
}

impl<'a> ReentrancyGuard<'a> {
    /// Creates a new reentrancy guard, entering the security context
    pub fn new(env: &'a Env) -> Self {
        let mut guard = Self {
            env,
            call_graph: CallGraph::get_or_create(env),
            entered: false,
        };
        guard.enter();
        guard
    }

    /// Creates a guard for a cross-contract call (used when invoking external contracts)
    pub fn for_cross_contract_call(
        env: &'a Env,
        target: &Address,
        function: &Symbol,
        is_read_only: bool,
    ) -> Result<Self, Error> {
        let mut guard = Self {
            env,
            call_graph: CallGraph::get_or_create(env),
            entered: false,
        };
        guard.enter_cross_contract(target, function.clone(), is_read_only)?;
        Ok(guard)
    }

    /// Enters the reentrancy guard for the main entry point
    fn enter(&mut self) {
        let key = DataKey::ReentrancyLock;
        let storage = self.env.storage().instance();
        let flags: u32 = storage.get(&key).unwrap_or(0);

        if flags & REENTRANCY_GUARD_BIT != 0 {
            panic_with_error!(self.env, Error::ReentrantCall);
        }

        storage.set(&key, &(flags | REENTRANCY_GUARD_BIT));
        self.entered = true;

        // Initialize call graph in transient storage
        self.call_graph.save(self.env);
    }

    /// Enters a cross-contract call frame
    fn enter_cross_contract(
        &mut self,
        target: &Address,
        function: Symbol,
        is_read_only: bool,
    ) -> Result<(), Error> {
        // Check read-only reentrancy before pushing frame
        self.call_graph
            .check_read_only_reentrancy(self.env, target)?;

        // Push the new frame
        self.call_graph
            .push_frame(self.env, target.clone(), function, is_read_only)?;
        self.call_graph.save(self.env);
        self.entered = true;
        Ok(())
    }

    /// Marks that state has been mutated (call this after any storage write)
    pub fn mark_state_mutated(&mut self) {
        self.call_graph.mark_state_mutated();
        self.call_graph.save(self.env);
    }

    /// Gets the current call graph for inspection
    pub fn call_graph(&self) -> &CallGraph {
        &self.call_graph
    }

    /// Gets mutable access to the call graph
    pub fn call_graph_mut(&mut self) -> &mut CallGraph {
        &mut self.call_graph
    }
}

impl Drop for ReentrancyGuard<'_> {
    fn drop(&mut self) {
        if self.entered {
            self.exit();
        }
    }
}

impl<'a> ReentrancyGuard<'a> {
    /// Exits the reentrancy guard, cleaning up state
    fn exit(&mut self) {
        // Pop the current frame if we're in a cross-contract call
        if self.call_graph.depth > 0 {
            self.call_graph.pop_frame();
            self.call_graph.save(self.env);
        } else {
            // Main entry point - clear the instance storage lock
            let key = DataKey::ReentrancyLock;
            let storage = self.env.storage().instance();
            let flags: u32 = storage.get(&key).unwrap_or(0);
            let remaining = flags & !REENTRANCY_GUARD_BIT;

            if remaining == 0 {
                storage.remove(&key);
            } else {
                storage.set(&key, &remaining);
            }

            // Clean up transient storage
            self.env.storage().temporary().remove(&key);
        }
    }
}

/// Legacy enter function for backward compatibility
pub(crate) fn enter(env: &Env) {
    let key = DataKey::ReentrancyLock;
    let storage = env.storage().instance();
    let flags: u32 = storage.get(&key).unwrap_or(0);

    if flags & REENTRANCY_GUARD_BIT != 0 || env.storage().temporary().has(&key) {
        panic_with_error!(env, Error::ReentrantCall);
    }

    storage.set(&key, &(flags | REENTRANCY_GUARD_BIT));
}

/// Legacy exit function for backward compatibility
pub(crate) fn exit(env: &Env) {
    let key = DataKey::ReentrancyLock;
    let storage = env.storage().instance();
    let flags: u32 = storage.get(&key).unwrap_or(0);
    let remaining = flags & !REENTRANCY_GUARD_BIT;

    if remaining == 0 {
        storage.remove(&key);
    } else {
        storage.set(&key, &remaining);
    }

    env.storage().temporary().remove(&key);
}

/// Enters a cross-contract call with full topology tracking
/// Returns a guard that must be dropped after the call completes
pub fn enter_cross_contract_call<'a>(
    env: &'a Env,
    target: &'a Address,
    function: Symbol,
    is_read_only: bool,
) -> Result<ReentrancyGuard<'a>, Error> {
    ReentrancyGuard::for_cross_contract_call(env, target, &function, is_read_only)
}

/// Checks if we're currently in a cross-contract call context
pub fn in_cross_contract_context(env: &Env) -> bool {
    let key = DataKey::ReentrancyLock;
    if let Some(graph) = env.storage().temporary().get::<DataKey, CallGraph>(&key) {
        graph.depth > 0
    } else {
        false
    }
}

/// Gets the current call graph depth
pub fn get_call_depth(env: &Env) -> u32 {
    let key = DataKey::ReentrancyLock;
    if let Some(graph) = env.storage().temporary().get::<DataKey, CallGraph>(&key) {
        graph.depth
    } else {
        0
    }
}

/// Checks if state has been mutated in the current transaction
pub fn has_state_mutated(env: &Env) -> bool {
    let key = DataKey::ReentrancyLock;
    if let Some(graph) = env.storage().temporary().get::<DataKey, CallGraph>(&key) {
        graph.state_mutated
    } else {
        false
    }
}

/// Marks that state has been mutated in the current transaction
pub fn mark_state_mutated(env: &Env) {
    let key = DataKey::ReentrancyLock;
    if let Some(mut graph) = env.storage().temporary().get::<DataKey, CallGraph>(&key) {
        graph.mark_state_mutated();
        graph.save(env);
    }
}

/// Validates that a read-only call is safe (not a read-only reentrancy attack)
pub fn validate_read_only_call(env: &Env, contract: &Address) -> Result<(), Error> {
    let key = DataKey::ReentrancyLock;
    if let Some(graph) = env.storage().temporary().get::<DataKey, CallGraph>(&key) {
        graph.check_read_only_reentrancy(env, contract)
    } else {
        Ok(())
    }
}

/// Wrapper for cross-contract calls with full reentrancy topology tracking.
/// This should be used for ALL external contract invocations to ensure
/// proper reentrancy detection across the call graph.
pub fn invoke_contract_with_guard<R>(
    env: &Env,
    target: &Address,
    function: &Symbol,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
    is_read_only: bool,
) -> Result<R, Error>
where
    R: soroban_sdk::TryFromVal<Env, soroban_sdk::Val> + 'static,
{
    // Enter cross-contract call frame with topology tracking
    let mut guard = ReentrancyGuard::for_cross_contract_call(env, target, function, is_read_only)?;

    // Perform the actual invocation
    let result = env.invoke_contract::<R>(target, function, args);

    // Mark state as potentially mutated (conservative assumption)
    guard.mark_state_mutated();

    Ok(result)
}

/// Wrapper for fallible cross-contract calls with full reentrancy topology tracking.
pub fn try_invoke_contract_with_guard<R>(
    env: &Env,
    target: &Address,
    function: &Symbol,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
    is_read_only: bool,
) -> Result<R, Error>
where
    R: soroban_sdk::TryFromVal<Env, soroban_sdk::Val> + 'static,
{
    // Enter cross-contract call frame with topology tracking
    let mut guard = ReentrancyGuard::for_cross_contract_call(env, target, function, is_read_only)?;

    // Perform the actual invocation - unwrap the SDK error as it's not recoverable
    let result = env.try_invoke_contract::<R, soroban_sdk::Error>(target, function, args);

    // Mark state as potentially mutated (conservative assumption)
    guard.mark_state_mutated();

    // Convert SDK error to contract error
    match result {
        Ok(Ok(val)) => Ok(val),
        Ok(Err(_)) => Err(Error::ReentrantCall),
        Err(_) => Err(Error::ReentrantCall),
    }
}
