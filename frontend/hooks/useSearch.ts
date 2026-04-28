'use client';

import { useState, useCallback, useMemo } from 'react';
import type { TaskFilters, SavedView, ActiveFilter, TaskStatus, TaskPriority } from '@/types/search';

const FILTER_LABELS: Record<keyof TaskFilters, string> = {
  query: 'Search',
  status: 'Status',
  assignee: 'Assignee',
  label: 'Label',
  priority: 'Priority',
  dueDateFrom: 'Due after',
  dueDateTo: 'Due before',
};

function formatFilterDisplayValue(field: keyof TaskFilters, value: TaskFilters[keyof TaskFilters]): string {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

function filtersToUrlParams(filters: TaskFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.status?.length) params.set('status', filters.status.join(','));
  if (filters.assignee?.length) params.set('assignee', filters.assignee.join(','));
  if (filters.label?.length) params.set('label', filters.label.join(','));
  if (filters.priority?.length) params.set('priority', filters.priority.join(','));
  if (filters.dueDateFrom) params.set('from', filters.dueDateFrom);
  if (filters.dueDateTo) params.set('to', filters.dueDateTo);
  return params;
}

function urlParamsToFilters(params: URLSearchParams): TaskFilters {
  const filters: TaskFilters = {};
  const q = params.get('q');
  if (q) filters.query = q;
  const status = params.get('status');
  if (status) filters.status = status.split(',') as TaskStatus[];
  const assignee = params.get('assignee');
  if (assignee) filters.assignee = assignee.split(',');
  const label = params.get('label');
  if (label) filters.label = label.split(',');
  const priority = params.get('priority');
  if (priority) filters.priority = priority.split(',') as TaskPriority[];
  const from = params.get('from');
  if (from) filters.dueDateFrom = from;
  const to = params.get('to');
  if (to) filters.dueDateTo = to;
  return filters;
}

interface UseSearchReturn {
  filters: TaskFilters;
  activeFilters: ActiveFilter[];
  savedViews: SavedView[];
  activeViewId: string | null;
  hasActiveFilters: boolean;
  setFilter: <K extends keyof TaskFilters>(field: K, value: TaskFilters[K]) => void;
  removeFilter: (filterId: string) => void;
  clearAllFilters: () => void;
  saveView: (name: string) => SavedView;
  loadView: (viewId: string) => void;
  deleteView: (viewId: string) => void;
  updateView: (viewId: string, name: string) => void;
  getShareableUrl: () => string;
  loadFromUrl: (search: string) => void;
}

export function useSearch(initialFilters: TaskFilters = {}): UseSearchReturn {
  const [filters, setFilters] = useState<TaskFilters>(initialFilters);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  // Derive active filters list for display
  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const result: ActiveFilter[] = [];
    let idCounter = 0;

    if (filters.query) {
      result.push({
        id: `filter-${idCounter++}`,
        field: 'query',
        label: FILTER_LABELS.query,
        displayValue: filters.query,
      });
    }
    if (filters.status?.length) {
      result.push({
        id: `filter-${idCounter++}`,
        field: 'status',
        label: FILTER_LABELS.status,
        displayValue: formatFilterDisplayValue('status', filters.status),
      });
    }
    if (filters.assignee?.length) {
      result.push({
        id: `filter-${idCounter++}`,
        field: 'assignee',
        label: FILTER_LABELS.assignee,
        displayValue: formatFilterDisplayValue('assignee', filters.assignee),
      });
    }
    if (filters.label?.length) {
      result.push({
        id: `filter-${idCounter++}`,
        field: 'label',
        label: FILTER_LABELS.label,
        displayValue: formatFilterDisplayValue('label', filters.label),
      });
    }
    if (filters.priority?.length) {
      result.push({
        id: `filter-${idCounter++}`,
        field: 'priority',
        label: FILTER_LABELS.priority,
        displayValue: formatFilterDisplayValue('priority', filters.priority),
      });
    }
    if (filters.dueDateFrom) {
      result.push({
        id: `filter-${idCounter++}`,
        field: 'dueDateFrom',
        label: FILTER_LABELS.dueDateFrom,
        displayValue: filters.dueDateFrom,
      });
    }
    if (filters.dueDateTo) {
      result.push({
        id: `filter-${idCounter++}`,
        field: 'dueDateTo',
        label: FILTER_LABELS.dueDateTo,
        displayValue: filters.dueDateTo,
      });
    }

    return result;
  }, [filters]);

  const hasActiveFilters = activeFilters.length > 0;

  const setFilter = useCallback(<K extends keyof TaskFilters>(field: K, value: TaskFilters[K]) => {
    setFilters((prev) => {
      // Clear value removes the filter
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return { ...prev, [field]: value };
    });
    // Changing filters deactivates any saved view
    setActiveViewId(null);
  }, []);

  const removeFilter = useCallback((filterId: string) => {
    const filter = activeFilters.find((f) => f.id === filterId);
    if (!filter) return;
    setFilters((prev) => {
      const next = { ...prev };
      delete next[filter.field];
      return next;
    });
    setActiveViewId(null);
  }, [activeFilters]);

  const clearAllFilters = useCallback(() => {
    setFilters({});
    setActiveViewId(null);
  }, []);

  const saveView = useCallback((name: string): SavedView => {
    const now = new Date().toISOString();
    const newView: SavedView = {
      id: `view-${Date.now()}`,
      name,
      filters: { ...filters },
      createdAt: now,
      updatedAt: now,
    };
    setSavedViews((prev) => [...prev, newView]);
    setActiveViewId(newView.id);
    return newView;
  }, [filters]);

  const loadView = useCallback((viewId: string) => {
    const view = savedViews.find((v) => v.id === viewId);
    if (!view) return;
    setFilters({ ...view.filters });
    setActiveViewId(viewId);
  }, [savedViews]);

  const deleteView = useCallback((viewId: string) => {
    setSavedViews((prev) => prev.filter((v) => v.id !== viewId));
    if (activeViewId === viewId) {
      setActiveViewId(null);
    }
  }, [activeViewId]);

  const updateView = useCallback((viewId: string, name: string) => {
    setSavedViews((prev) =>
      prev.map((v) =>
        v.id === viewId
          ? { ...v, name, filters: { ...filters }, updatedAt: new Date().toISOString() }
          : v
      )
    );
  }, [filters]);

  const getShareableUrl = useCallback((): string => {
    const params = filtersToUrlParams(filters);
    const paramStr = params.toString();
    if (typeof window !== 'undefined') {
      return `${window.location.origin}${window.location.pathname}${paramStr ? `?${paramStr}` : ''}`;
    }
    return paramStr ? `?${paramStr}` : '';
  }, [filters]);

  const loadFromUrl = useCallback((search: string) => {
    const params = new URLSearchParams(search);
    const parsed = urlParamsToFilters(params);
    setFilters(parsed);
    setActiveViewId(null);
  }, []);

  return {
    filters,
    activeFilters,
    savedViews,
    activeViewId,
    hasActiveFilters,
    setFilter,
    removeFilter,
    clearAllFilters,
    saveView,
    loadView,
    deleteView,
    updateView,
    getShareableUrl,
    loadFromUrl,
  };
}
