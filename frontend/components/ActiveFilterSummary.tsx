'use client';

import type { ActiveFilter } from '@/types/search';

interface ActiveFilterSummaryProps {
  activeFilters: ActiveFilter[];
  onRemoveFilter: (filterId: string) => void;
  onClearAll: () => void;
}

export function ActiveFilterSummary({ activeFilters, onRemoveFilter, onClearAll }: ActiveFilterSummaryProps) {
  if (activeFilters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Active filters">
      <span className="text-xs text-neutral-500 font-medium">Filters:</span>
      {activeFilters.map((filter) => (
        <span
          key={filter.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-xs text-blue-300"
        >
          <span className="text-blue-400/70">{filter.label}:</span>
          <span className="font-medium truncate max-w-[120px]" title={filter.displayValue}>
            {filter.displayValue}
          </span>
          <button
            type="button"
            onClick={() => onRemoveFilter(filter.id)}
            className="text-blue-400/60 hover:text-blue-300 transition-colors ml-0.5 flex-shrink-0"
            aria-label={`Remove ${filter.label} filter`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      {activeFilters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
