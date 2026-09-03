//! Iterative DAG validation for task dependency graphs.
//!
//! Replaces recursive DFS with explicit stack-based traversal to avoid Soroban
//! call-stack exhaustion on deep graphs.

use soroban_sdk::{Env, Vec};

use crate::Error;

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
        .or_else(|| {
            crate::storage::load_legacy_task(env, task_id).map(|c| c.blocked_by)
        })
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
pub fn validate_new_dependency(
    env: &Env,
    task_id: u64,
    new_parent: u64,
) -> Result<(), Error> {
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
