"use client";

import { create } from "zustand";

/**
 * Multi-select state backing the Batch Task Console (#1265).
 *
 * Selection is intentionally view-agnostic (a flat set of task ids) so the
 * tasks list, board and the `/tasks/bulk` console all share the same batch.
 * The console assembles a single atomic Soroban transaction from the ids in
 * `selectedIds` — one Freighter signature for the whole action.
 */
export interface TaskBulkSelectionState {
  selectedIds: string[];
  /** Toggle a single task in/out of the batch. */
  toggle: (taskId: string) => void;
  /** Mark an arbitrary set of tasks selected (or deselect them). */
  selectMany: (taskIds: string[], selected: boolean) => void;
  /** Replace the selection with exactly the given ids. */
  setSelection: (taskIds: string[]) => void;
  /** Drop every selected task. */
  clear: () => void;
}

export const useTaskBulkSelection = create<TaskBulkSelectionState>((set) => ({
  selectedIds: [],

  toggle: (taskId) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(taskId)
        ? state.selectedIds.filter((id) => id !== taskId)
        : [...state.selectedIds, taskId],
    })),

  selectMany: (taskIds, selected) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      for (const id of taskIds) {
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return { selectedIds: Array.from(next) };
    }),

  setSelection: (taskIds) => set({ selectedIds: Array.from(new Set(taskIds)) }),

  clear: () => set({ selectedIds: [] }),
}));

/** True when the given task is part of the current batch. */
export function isBatchSelected(selectedIds: string[], taskId: string): boolean {
  return selectedIds.includes(taskId);
}

/** Expected checkbox label for a task row, used in tests/a11y queries. */
export function taskCheckboxLabel(taskId: string): string {
  return `Select task ${taskId} for batch`;
}