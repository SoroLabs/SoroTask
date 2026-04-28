# Task Dependencies

## Overview

Task dependencies allow you to define relationships between tasks where one task must complete before another can execute. This enables complex workflow orchestration and ensures proper execution order.

## Key Concepts

### Blocking Relationships

- A task can be **blocked by** one or more other tasks
- A blocked task cannot execute until all its dependencies have completed at least once
- Dependencies are identified by task ID

### Dependency States

- **Blocking**: The dependency task has not executed yet (`last_run = 0`)
- **Completed**: The dependency task has executed at least once (`last_run > 0`)

## Contract Functions

### `add_dependency(task_id: u64, depends_on_task_id: u64)`

Adds a dependency relationship where `task_id` is blocked by `depends_on_task_id`.

**Authorization**: Only the task creator can add dependencies

**Validations**:
- Both tasks must exist
- Cannot create self-dependency (task depending on itself)
- Cannot create circular dependencies
- Duplicate dependencies are ignored

**Events**: Emits `DependencyAdded(task_id, depends_on_task_id)`

**Example**:
```rust
// Task 2 will be blocked by Task 1
client.add_dependency(&2, &1);
```

### `remove_dependency(task_id: u64, depends_on_task_id: u64)`

Removes a dependency relationship.

**Authorization**: Only the task creator can remove dependencies

**Events**: Emits `DependencyRemoved(task_id, depends_on_task_id)`

**Example**:
```rust
// Remove the dependency
client.remove_dependency(&2, &1);
```

### `get_dependencies(task_id: u64) -> Vec<u64>`

Returns all task IDs that block the specified task.

**Example**:
```rust
let deps = client.get_dependencies(&2);
// Returns: [1, 3] if task 2 depends on tasks 1 and 3
```

### `is_task_blocked(task_id: u64) -> bool`

Checks if a task is currently blocked by any incomplete dependencies.

**Returns**: `true` if any dependency has not executed yet, `false` otherwise

**Example**:
```rust
let blocked = client.is_task_blocked(&2);
// Returns: true if any dependency hasn't run yet
```

## Execution Behavior

When `execute()` is called on a task:

1. All standard checks are performed (active, whitelist, interval)
2. **Dependency check**: If any dependency has `last_run = 0`, execution fails with `Error::DependencyBlocked`
3. If all dependencies are satisfied, execution proceeds normally

## Error Codes

| Error | Code | Description |
|-------|------|-------------|
| `SelfDependency` | 8 | Attempted to create a dependency on itself |
| `DependencyNotFound` | 9 | Referenced task does not exist |
| `CircularDependency` | 10 | Would create a circular dependency chain |
| `DependencyBlocked` | 11 | Task cannot execute due to incomplete dependencies |

## Circular Dependency Detection

The contract uses depth-first search (DFS) to detect circular dependencies before adding a new relationship.

**Example of prevented circular dependency**:
```
Task 1 → Task 2 → Task 3
         ↑_____________|  ← This would be rejected
```

## UI Features

### Task Card

- Shows dependency count badge
- Displays "Blocked" status for tasks with incomplete dependencies
- Lists dependency task IDs

### Task Detail Modal

- Full dependency management interface
- Add new dependencies via dropdown
- Remove existing dependencies
- Visual status indicators (Blocking/Completed)
- Shows dependency task details

### Blocked Tasks Alert

- Dashboard alert when tasks are blocked
- Shows count of blocked tasks
- Helps users identify workflow bottlenecks

## Usage Examples

### Simple Sequential Workflow

```rust
// Create tasks
let task1 = client.register(&config1); // harvest
let task2 = client.register(&config2); // compound
let task3 = client.register(&config3); // rebalance

// Set up dependencies: harvest → compound → rebalance
client.add_dependency(&task2, &task1);
client.add_dependency(&task3, &task2);

// Execution order will be enforced:
// 1. Task 1 executes first
// 2. Task 2 can execute after Task 1 completes
// 3. Task 3 can execute after Task 2 completes
```

### Parallel Dependencies

```rust
// Create tasks
let task1 = client.register(&config1); // fetch_price_feed_a
let task2 = client.register(&config2); // fetch_price_feed_b
let task3 = client.register(&config3); // calculate_average

// Task 3 depends on both Task 1 and Task 2
client.add_dependency(&task3, &task1);
client.add_dependency(&task3, &task2);

// Task 3 will only execute after both Task 1 AND Task 2 have completed
```

### Conditional Workflow

```rust
// Create tasks with resolvers
let task1 = client.register(&config1); // check_condition
let task2 = client.register(&config2); // action_if_true

// Task 2 depends on Task 1
client.add_dependency(&task2, &task1);

// Task 1 uses a resolver to check conditions
// Task 2 will only execute after Task 1 has run at least once
// (regardless of Task 1's resolver result)
```

## Best Practices

1. **Keep dependency chains short**: Long chains increase complexity and debugging difficulty
2. **Document workflow logic**: Use clear task names and maintain external documentation
3. **Monitor blocked tasks**: Regularly check for tasks stuck due to failed dependencies
4. **Test dependency graphs**: Verify your workflow logic before deploying to production
5. **Handle failures gracefully**: Consider what happens if a dependency task fails or is paused

## Limitations

- Dependencies are based on execution completion, not success/failure
- A dependency is satisfied once `last_run > 0`, even if the execution failed
- Removing a task does not automatically remove dependencies referencing it
- Maximum dependency depth is limited by contract execution resources

## Testing

The contract includes comprehensive tests for:
- Adding and removing dependencies
- Self-dependency prevention
- Circular dependency detection
- Blocked task execution
- Dependency state checking

Run tests with:
```bash
cd contract
cargo test
```

## Frontend Integration

The frontend provides a complete UI for managing dependencies:

```typescript
// Add dependency
await onAddDependency(taskId, dependsOnTaskId);

// Remove dependency
await onRemoveDependency(taskId, dependsOnTaskId);

// Check if task is blocked
const isBlocked = task.blockedBy.length > 0 && task.lastRun === 0;
```

See `frontend/components/TaskDependencyManager.tsx` for implementation details.
