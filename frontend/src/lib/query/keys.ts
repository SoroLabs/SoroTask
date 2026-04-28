// Typed query-key factory.
//
// All query keys flow through this module. The convention is a tiered
// hierarchy per entity:
//
//   tasks.all                        → ['tasks']
//   tasks.lists()                    → ['tasks', 'list']
//   tasks.list(filters)              → ['tasks', 'list', filters]
//   tasks.details()                  → ['tasks', 'detail']
//   tasks.detail(id)                 → ['tasks', 'detail', id]
//
// Why the structure matters:
//
// - `queryClient.invalidateQueries({ queryKey: tasks.all })` invalidates
//   every tasks-related cache entry (lists *and* details).
// - `queryClient.invalidateQueries({ queryKey: tasks.lists() })`
//   invalidates only list views, leaving cached detail views warm.
// - `queryClient.invalidateQueries({ queryKey: tasks.detail(id) })`
//   invalidates a single detail view.
//
// Keep all key construction here. Inline keys in components defeat the
// invalidation precision the tiered structure buys you, and quickly
// drift out of sync.

export interface TaskFilters {
  status?: "pending" | "running" | "success" | "failed";
  search?: string;
}

export const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters: TaskFilters = {}) =>
    [...taskKeys.lists(), filters] as const,
  details: () => [...taskKeys.all, "detail"] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
} as const;

// Add new entities below. Each entity should mirror the same five-method
// shape (`all`, `lists`, `list`, `details`, `detail`) so the invalidation
// rules are consistent across the codebase.
//
// Example:
//
// export const executionKeys = {
//   all: ['executions'] as const,
//   lists: () => [...executionKeys.all, 'list'] as const,
//   list: (filters: ExecutionFilters = {}) =>
//     [...executionKeys.lists(), filters] as const,
//   ...
// } as const;
