// Search, filter, and saved views types

export type TaskStatus = 'active' | 'paused' | 'completed' | 'failed';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type FilterOperator = 'is' | 'is_not' | 'contains' | 'not_contains' | 'before' | 'after' | 'between';

export interface FilterValue {
  operator: FilterOperator;
  value: string | string[] | DateRange;
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Execution interval buckets (issue #874).
 *
 * Buckets rather than a raw seconds range: users reason about automations as
 * "hourly" or "daily", and a numeric input would require them to know the
 * schedule is stored in seconds.
 */
export type IntervalBucket = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'custom';

/**
 * Gas balance health, relative to each task's own top-up threshold.
 *
 * Absolute amounts are not comparable across tasks — a balance that is
 * healthy for a daily task is critical for one running every minute — so this
 * filters on the derived state, not the number.
 */
export type GasBalanceBand = 'healthy' | 'low' | 'critical' | 'empty';

export interface TaskFilters {
  query?: string;
  status?: TaskStatus[];
  assignee?: string[];
  label?: string[];
  priority?: TaskPriority[];
  dueDateFrom?: string;
  dueDateTo?: string;
  /** Task creator addresses (#874). */
  creator?: string[];
  /** Target contract addresses the task invokes (#874). */
  target?: string[];
  /** Execution cadence buckets (#874). */
  interval?: IntervalBucket[];
  /** Gas balance health bands (#874). */
  gasBalance?: GasBalanceBand[];
}

export interface ActiveFilter {
  id: string;
  field: keyof TaskFilters;
  label: string;
  displayValue: string;
}

export interface SavedView {
  id: string;
  name: string;
  filters: TaskFilters;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

export interface SearchState {
  filters: TaskFilters;
  savedViews: SavedView[];
  activeViewId: string | null;
}

// URL serialization helpers
export type SerializedFilters = Record<string, string>;
