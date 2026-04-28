'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { TaskFilters, TaskStatus, TaskPriority } from '@/types/search';

interface SearchFilterPanelProps {
  filters: TaskFilters;
  onFilterChange: <K extends keyof TaskFilters>(field: K, value: TaskFilters[K]) => void;
  onClearAll: () => void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'active', label: 'Active', color: 'text-green-400' },
  { value: 'paused', label: 'Paused', color: 'text-yellow-400' },
  { value: 'completed', label: 'Completed', color: 'text-blue-400' },
  { value: 'failed', label: 'Failed', color: 'text-red-400' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'critical', label: 'Critical', color: 'text-red-400' },
  { value: 'high', label: 'High', color: 'text-orange-400' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-400' },
  { value: 'low', label: 'Low', color: 'text-neutral-400' },
];

const LABEL_OPTIONS = ['automation', 'defi', 'yield', 'governance', 'maintenance', 'monitoring'];

const ASSIGNEE_OPTIONS = ['alice.xlm', 'bob.xlm', 'carol.xlm', 'dave.xlm'];

function MultiSelectDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
  renderOption,
}: {
  label: string;
  options: { value: T; label: string; color?: string }[];
  selected: T[];
  onChange: (values: T[]) => void;
  renderOption?: (opt: { value: T; label: string; color?: string }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = (value: T) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
          selected.length > 0
            ? 'bg-blue-500/10 border-blue-500/40 text-blue-300'
            : 'bg-neutral-800 border-neutral-700/50 text-neutral-300 hover:border-neutral-600'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="bg-blue-500/20 text-blue-400 text-xs px-1.5 py-0.5 rounded-full font-medium">
            {selected.length}
          </span>
        )}
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-20 bg-neutral-800 border border-neutral-700/50 rounded-lg shadow-xl min-w-[160px] py-1"
          role="listbox"
          aria-multiselectable="true"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={selected.includes(opt.value)}
              onClick={() => toggle(opt.value)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-neutral-700/50 transition-colors text-left"
            >
              <span
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                  selected.includes(opt.value)
                    ? 'bg-blue-500 border-blue-500'
                    : 'border-neutral-600'
                }`}
              >
                {selected.includes(opt.value) && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              {renderOption ? renderOption(opt) : (
                <span className={opt.color ?? 'text-neutral-200'}>{opt.label}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchFilterPanel({ filters, onFilterChange, onClearAll }: SearchFilterPanelProps) {
  const [searchValue, setSearchValue] = useState(filters.query ?? '');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external filter changes back to local input
  useEffect(() => {
    setSearchValue(filters.query ?? '');
  }, [filters.query]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchValue(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      onFilterChange('query', val || undefined);
    }, 300);
  }, [onFilterChange]);

  const handleSearchClear = useCallback(() => {
    setSearchValue('');
    onFilterChange('query', undefined);
  }, [onFilterChange]);

  const hasAnyFilter =
    !!filters.query ||
    (filters.status?.length ?? 0) > 0 ||
    (filters.assignee?.length ?? 0) > 0 ||
    (filters.label?.length ?? 0) > 0 ||
    (filters.priority?.length ?? 0) > 0 ||
    !!filters.dueDateFrom ||
    !!filters.dueDateTo;

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={searchValue}
          onChange={handleSearchChange}
          placeholder="Search tasks..."
          className="w-full bg-neutral-800 border border-neutral-700/50 rounded-lg pl-10 pr-10 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:text-neutral-500"
          aria-label="Search tasks"
        />
        {searchValue && (
          <button
            type="button"
            onClick={handleSearchClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 transition-colors"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectDropdown
          label="Status"
          options={STATUS_OPTIONS}
          selected={filters.status ?? []}
          onChange={(v) => onFilterChange('status', v.length ? v : undefined)}
          renderOption={(opt) => (
            <span className={opt.color}>{opt.label}</span>
          )}
        />

        <MultiSelectDropdown
          label="Priority"
          options={PRIORITY_OPTIONS}
          selected={filters.priority ?? []}
          onChange={(v) => onFilterChange('priority', v.length ? v : undefined)}
          renderOption={(opt) => (
            <span className={opt.color}>{opt.label}</span>
          )}
        />

        <MultiSelectDropdown
          label="Assignee"
          options={ASSIGNEE_OPTIONS.map((a) => ({ value: a, label: a }))}
          selected={filters.assignee ?? []}
          onChange={(v) => onFilterChange('assignee', v.length ? v : undefined)}
        />

        <MultiSelectDropdown
          label="Label"
          options={LABEL_OPTIONS.map((l) => ({ value: l, label: l }))}
          selected={filters.label ?? []}
          onChange={(v) => onFilterChange('label', v.length ? v : undefined)}
        />

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <input
              type="date"
              value={filters.dueDateFrom ?? ''}
              onChange={(e) => onFilterChange('dueDateFrom', e.target.value || undefined)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors bg-neutral-800 outline-none focus:ring-2 focus:ring-blue-500 ${
                filters.dueDateFrom
                  ? 'border-blue-500/40 text-blue-300'
                  : 'border-neutral-700/50 text-neutral-300'
              }`}
              aria-label="Due date from"
              title="Due date from"
            />
          </div>
          {(filters.dueDateFrom || filters.dueDateTo) && (
            <span className="text-neutral-500 text-xs">to</span>
          )}
          {filters.dueDateFrom && (
            <div className="relative">
              <input
                type="date"
                value={filters.dueDateTo ?? ''}
                onChange={(e) => onFilterChange('dueDateTo', e.target.value || undefined)}
                min={filters.dueDateFrom}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors bg-neutral-800 outline-none focus:ring-2 focus:ring-blue-500 ${
                  filters.dueDateTo
                    ? 'border-blue-500/40 text-blue-300'
                    : 'border-neutral-700/50 text-neutral-300'
                }`}
                aria-label="Due date to"
                title="Due date to"
              />
            </div>
          )}
        </div>

        {/* Clear all */}
        {hasAnyFilter && (
          <button
            type="button"
            onClick={onClearAll}
            className="ml-auto text-xs text-neutral-400 hover:text-neutral-200 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
