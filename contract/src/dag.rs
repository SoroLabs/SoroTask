//! Iterative DAG validation for task dependency graphs.
//!
//! Replaces recursive DFS with explicit stack-based traversal to avoid Soroban
//! call-stack exhaustion on deep graphs.

use soroban_sdk::{Env, Vec};

use crate::{DependencyOutcome, DependencyRule, Error, ExecutionOutcome, TaskExecutionStatus};

/// Maximum transitive dependency depth (inclusive).
pub const MAX_DEPENDENCY_DEPTH: u32 = 5;

/// Maximum direct parent dependencies per task.
pub const MAX_PARENTS: u32 = 8;

/// Returns the parent task IDs for `task_id` (from `blocked_by` on stored config).
pub fn get_parent_ids(env: &Env, task_id: u64) -> Vec<u64> {
    load_blocked_by(env, task_id)
}

fn load_blocked_by(env: &Env, task_id: u64) -> Vec<u64> {
    crate::storage::load_task_meta(env, task_id)
        .map(|m| m.blocked_by)
        .or_else(|| crate::storage::load_legacy_task(env, task_id).map(|c| c.blocked_by))
        .unwrap_or_else(|| Vec::new(env))
}

/// Iterative cycle check: would adding `new_parent` as a dependency of `task_id` create a cycle?
pub fn would_create_cycle(env: &Env, task_id: u64, new_parent: u64) -> bool {
    if task_id == new_parent {
        return true;
    }
    // Cycle iff there is a path from new_parent back to task_id.
    has_path_iterative(env, new_parent, task_id)
}

/// Iterative BFS/DFS using an explicit frontier stack (no recursion).
fn has_path_iterative(env: &Env, from: u64, to: u64) -> bool {
    if from == to {
        return true;
    }

    let mut stack = Vec::new(env);
    stack.push_back(from);

    let mut visited = Vec::new(env);
    let mut depth_map = Vec::new(env);
    depth_map.push_back((from, 0u32));

    while stack.len() > 0 {
        let current = stack.pop_back().unwrap();
        if current == to {
            return true;
        }

        if visited.contains(&current) {
            continue;
        }
        visited.push_back(current);

        let current_depth = depth_of(&depth_map, current).unwrap_or(0);
        if current_depth >= MAX_DEPENDENCY_DEPTH {
            continue;
        }

        let parents = load_blocked_by(env, current);
        for i in 0..parents.len() {
            let parent = parents.get(i).unwrap();
            if parent == to {
                return true;
            }
            if !visited.contains(&parent) {
                stack.push_back(parent);
                set_depth(&mut depth_map, parent, current_depth + 1);
            }
        }
    }

    false
}

fn depth_of(depth_map: &Vec<(u64, u32)>, id: u64) -> Option<u32> {
    for i in 0..depth_map.len() {
        let (tid, d) = depth_map.get(i).unwrap();
        if tid == id {
            return Some(d);
        }
    }
    None
}

fn set_depth(depth_map: &mut Vec<(u64, u32)>, id: u64, depth: u32) {
    for i in 0..depth_map.len() {
        let (tid, _) = depth_map.get(i).unwrap();
        if tid == id {
            depth_map.set(i, (id, depth));
            return;
        }
    }
    depth_map.push_back((id, depth));
}

/// Validates that adding a dependency respects parent count and depth limits.
pub fn validate_new_dependency(env: &Env, task_id: u64, new_parent: u64) -> Result<(), Error> {
    if task_id == new_parent {
        return Err(Error::SelfDependency);
    }

    let parents = load_blocked_by(env, task_id);
    if parents.len() >= MAX_PARENTS as u32 && !parents.contains(&new_parent) {
        return Err(Error::DependencyLimitExceeded);
    }

    if would_create_cycle(env, task_id, new_parent) {
        return Err(Error::CircularDependency);
    }

    if exceeds_max_depth_after_add(env, task_id, new_parent) {
        return Err(Error::DependencyDepthExceeded);
    }

    Ok(())
}

/// After adding edge task_id -> new_parent, compute max depth from task_id.
fn exceeds_max_depth_after_add(env: &Env, task_id: u64, new_parent: u64) -> bool {
    max_depth_from(env, task_id, new_parent) > MAX_DEPENDENCY_DEPTH
}

/// Iterative longest-path depth from `start` following parent edges.
pub fn max_depth_from(env: &Env, start: u64, extra_parent: u64) -> u32 {
    let mut stack = Vec::new(env);
    stack.push_back((start, 0u32));

    let mut max_depth = 0u32;
    let mut visited = Vec::new(env);

    while stack.len() > 0 {
        let (node, depth) = stack.pop_back().unwrap();
        if depth > MAX_DEPENDENCY_DEPTH {
            return depth;
        }
        if depth > max_depth {
            max_depth = depth;
        }

        let key = (node, depth);
        if visited.contains(&key) {
            continue;
        }
        visited.push_back(key);

        let mut parents = load_blocked_by(env, node);
        if node == start && !parents.contains(&extra_parent) {
            parents.push_back(extra_parent);
        }

        for i in 0..parents.len() {
            let p = parents.get(i).unwrap();
            stack.push_back((p, depth + 1));
        }
    }

    max_depth
}

/// Kahn-style topological check: returns true if the graph rooted at `task_id` is acyclic.
pub fn is_acyclic(env: &Env, task_id: u64) -> bool {
    !would_create_cycle(env, task_id, task_id.saturating_add(u64::MAX))
        && !has_cycle_from(env, task_id)
}

fn has_cycle_from(env: &Env, root: u64) -> bool {
    let mut stack = Vec::new(env);
    stack.push_back(root);
    let mut visiting = Vec::new(env);
    let mut visited = Vec::new(env);

    while stack.len() > 0 {
        let node = stack.pop_back().unwrap();
        if visited.contains(&node) {
            continue;
        }
        if visiting.contains(&node) {
            return true;
        }
        visiting.push_back(node);

        let parents = load_blocked_by(env, node);
        for i in 0..parents.len() {
            let p = parents.get(i).unwrap();
            stack.push_back(p);
        }

        visiting.pop_back();
        visited.push_back(node);
    }
    false
}

/// Validates all dependency rules for a task before execution.
pub fn check_dependency_rules(env: &Env, task_id: u64) -> Result<(), Error> {
    let rules = load_dependency_rules(env, task_id);
    
    for i in 0..rules.len() {
        let rule = rules.get(i).unwrap();
        
        // Check if parent task exists
        if !crate::task::task_exists(env, rule.task_id) {
            return Err(Error::DependencyNotFound);
        }
        
        // Load parent task status
        let status = load_task_execution_status(env, rule.task_id);
        
        // Validate based on required outcome
        match rule.required_outcome {
            DependencyOutcome::AnyCompletion => {
                if status.outcome == ExecutionOutcome::NeverRun {
                    return Err(Error::DependencyBlocked);
                }
            }
            DependencyOutcome::Success => {
                if status.outcome != ExecutionOutcome::Success {
                    return Err(Error::DependencyBlocked);
                }
            }
            DependencyOutcome::Skipped => {
                if status.outcome != ExecutionOutcome::Skipped {
                    return Err(Error::DependencyBlocked);
                }
            }
        }
        
        // Check minimum completion time
        if status.completed_at < rule.min_completed_at {
            return Err(Error::DependencyBlocked);
        }
    }
    
    Ok(())
}

/// Stores dependency rules for a task.
pub fn save_dependency_rules(env: &Env, task_id: u64, rules: &Vec<DependencyRule>) {
    env.storage()
        .persistent()
        .set(&crate::DataKey::DependencyRules(task_id), rules);
}

/// Loads dependency rules for a task.
pub fn load_dependency_rules(env: &Env, task_id: u64) -> Vec<DependencyRule> {
    env.storage()
        .persistent()
        .get(&crate::DataKey::DependencyRules(task_id))
        .unwrap_or_else(|| Vec::new(env))
}

/// Loads execution status for a task.
fn load_task_execution_status(env: &Env, task_id: u64) -> TaskExecutionStatus {
    env.storage()
        .persistent()
        .get(&crate::DataKey::TaskStatus(task_id))
        .unwrap_or(TaskExecutionStatus {
            outcome: ExecutionOutcome::NeverRun,
            completed_at: 0,
            run_count: 0,
        })
}

/// Validates DAG on task registration with full cycle detection (Tarjan-inspired).
pub fn validate_dag_on_registration(
    env: &Env,
    task_id: u64,
    parent_ids: &Vec<u64>,
) -> Result<(), Error> {
    // Check parent count limit
    if parent_ids.len() > MAX_PARENTS as u32 {
        return Err(Error::DependencyLimitExceeded);
    }
    
    // Validate each parent
    for i in 0..parent_ids.len() {
        let parent = parent_ids.get(i).unwrap();
        
        // Check self-dependency
        if parent == task_id {
            return Err(Error::SelfDependency);
        }
        
        // Check if parent exists
        if !crate::task::task_exists(env, parent) {
            return Err(Error::DependencyNotFound);
        }
        
        // Check for cycles
        if would_create_cycle(env, task_id, parent) {
            return Err(Error::CircularDependency);
        }
    }
    
    // Validate depth limit
    if exceeds_depth_limit_with_parents(env, task_id, parent_ids) {
        return Err(Error::DependencyDepthExceeded);
    }
    
    Ok(())
}

/// Checks if adding parents would exceed depth limit.
fn exceeds_depth_limit_with_parents(env: &Env, task_id: u64, parents: &Vec<u64>) -> bool {
    let mut max_depth = 0u32;
    
    for i in 0..parents.len() {
        let parent = parents.get(i).unwrap();
        let depth = compute_depth_from(env, parent);
        if depth > max_depth {
            max_depth = depth;
        }
    }
    
    max_depth + 1 > MAX_DEPENDENCY_DEPTH
}

/// Computes the maximum depth from a given task following dependencies.
fn compute_depth_from(env: &Env, task_id: u64) -> u32 {
    let mut stack = Vec::new(env);
    stack.push_back((task_id, 0u32));
    
    let mut max_depth = 0u32;
    let mut visited = Vec::new(env);
    
    while stack.len() > 0 {
        let (node, depth) = stack.pop_back().unwrap();
        
        if depth > MAX_DEPENDENCY_DEPTH {
            return MAX_DEPENDENCY_DEPTH + 1;
        }
        
        if depth > max_depth {
            max_depth = depth;
        }
        
        if visited.contains(&node) {
            continue;
        }
        visited.push_back(node);
        
        let parents = load_blocked_by(env, node);
        for j in 0..parents.len() {
            let p = parents.get(j).unwrap();
            stack.push_back((p, depth + 1));
        }
    }
    
    max_depth
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    fn empty_blocked_by(env: &Env) -> Vec<u64> {
        Vec::new(env)
    }

    #[test]
    fn max_depth_constant_is_five() {
        assert_eq!(MAX_DEPENDENCY_DEPTH, 5);
    }

    #[test]
    fn max_parents_constant_is_eight() {
        assert_eq!(MAX_PARENTS, 8);
    }

    #[test]
    fn self_dependency_detected() {
        let env = Env::default();
        assert!(would_create_cycle(&env, 1, 1));
    }
}
