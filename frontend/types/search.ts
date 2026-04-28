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

export interface TaskFilters {
  query?: string;
  status?: TaskStatus[];
  assignee?: string[];
  label?: string[];
  priority?: TaskPriority[];
  dueDateFrom?: string;
  dueDateTo?: string;
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
