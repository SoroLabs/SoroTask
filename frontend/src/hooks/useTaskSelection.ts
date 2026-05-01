"use client";

import { useCallback } from "react";
import { useLayoutStore } from "@/src/store/layoutStore";

/**
 * Hook for managing task selection in list/board views.
 * Provides a consistent interface for opening the detail pane.
 */
export function useTaskSelection() {
  const { selectedTaskId, openDetailPane, closeDetailPane } = useLayoutStore();

  const selectTask = useCallback(
    (taskId: string) => {
      openDetailPane(taskId);
    },
    [openDetailPane]
  );

  const deselectTask = useCallback(() => {
    closeDetailPane();
  }, [closeDetailPane]);

  const isTaskSelected = useCallback(
    (taskId: string) => {
      return selectedTaskId === taskId;
    },
    [selectedTaskId]
  );

  return {
    selectedTaskId,
    selectTask,
    deselectTask,
    isTaskSelected,
  };
}
