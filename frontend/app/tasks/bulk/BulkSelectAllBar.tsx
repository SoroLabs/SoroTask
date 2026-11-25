'use client';

import React, { useMemo } from 'react';
import { useTaskBulkSelection } from './bulkSelectionStore';

interface BulkSelectAllBarProps {
  /** Task ids visible on the current page/table. */
  pageTaskIds: string[];
  /** Total number of tasks in the current filtered result set. */
  totalResults: number;
}

/**
 * Select-all control for the tasks table (#1265, "Medium" tier).
 *
 * The header checkbox toggles every task on the current page; an explicit
 * "select all results" affordance extends the batch across the whole filtered
 * result set when it spans more than the visible page.
 */
export default function BulkSelectAllBar({ pageTaskIds, totalResults }: BulkSelectAllBarProps) {
  const { selectedIds, selectMany, clear } = useTaskBulkSelection();

  const selectedOnPage = useMemo(() => {
    const pageSet = new Set(pageTaskIds);
    return selectedIds.filter((id) => pageSet.has(id));
  }, [selectedIds, pageTaskIds]);

  const allOnPageSelected = pageTaskIds.length > 0 && selectedOnPage.length === pageTaskIds.length;
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;
  const allResultsSelected = totalResults > 0 && selectedIds.length === totalResults;

  const handlePageSelect = () => {
    selectMany(pageTaskIds, !allOnPageSelected);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-300">
      <label className="flex items-center gap-2 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={allOnPageSelected}
          onChange={handlePageSelect}
          aria-label="Select all tasks on this page"
          data-testid="bulk-select-all-page"
          className="h-4 w-4 rounded border-neutral-600 bg-neutral-900 text-primary-500 focus:ring-primary-500"
        />
        {someOnPageSelected ? 'Some tasks selected' : 'Select all on this page'}
      </label>

      {pageTaskIds.length < totalResults && (
        <button
          type="button"
          onClick={() => selectMany(pageTaskIds, true)}
          disabled={allResultsSelected}
          className="rounded-lg border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-200 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Select all {totalResults} results
        </button>
      )}

      {selectedIds.length > 0 && (
        <>
          <span className="text-neutral-400">
            {selectedIds.length} selected
          </span>
          <button
            type="button"
            onClick={clear}
            className="text-xs text-neutral-400 hover:text-neutral-200 hover:underline"
          >
            Clear selection
          </button>
        </>
      )}
    </div>
  );
}