import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LayoutState {
  /** Width of the detail pane as a percentage (0-100) */
  detailPaneWidth: number;
  /** Currently selected task ID for the detail pane */
  selectedTaskId: string | null;
  /** Scroll position of the list view (preserved across pane open/close) */
  listScrollPosition: number;
  /** Board column scroll positions keyed by column ID */
  boardScrollPositions: Record<string, number>;
}

export interface LayoutActions {
  /** Set the detail pane width percentage */
  setDetailPaneWidth: (width: number) => void;
  /** Open the detail pane for a specific task */
  openDetailPane: (taskId: string) => void;
  /** Close the detail pane */
  closeDetailPane: () => void;
  /** Save the list scroll position */
  saveListScrollPosition: (position: number) => void;
  /** Save a board column scroll position */
  saveBoardScrollPosition: (columnId: string, position: number) => void;
  /** Reset to default state */
  reset: () => void;
}

export type LayoutStore = LayoutState & LayoutActions;

// ── Initial state ─────────────────────────────────────────────────────────────

const INITIAL_STATE: LayoutState = {
  detailPaneWidth: 40, // Default 60/40 split (40% for detail pane)
  selectedTaskId: null,
  listScrollPosition: 0,
  boardScrollPositions: {},
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setDetailPaneWidth(width: number) {
        // Clamp between reasonable bounds
        const clampedWidth = Math.max(30, Math.min(70, width));
        set({ detailPaneWidth: clampedWidth });
      },

      openDetailPane(taskId: string) {
        set({ selectedTaskId: taskId });
      },

      closeDetailPane() {
        set({ selectedTaskId: null });
      },

      saveListScrollPosition(position: number) {
        set({ listScrollPosition: position });
      },

      saveBoardScrollPosition(columnId: string, position: number) {
        set((state: LayoutState) => ({
          boardScrollPositions: {
            ...state.boardScrollPositions,
            [columnId]: position,
          },
        }));
      },

      reset() {
        set(INITIAL_STATE);
      },
    }),
    {
      name: "sorotask-layout-storage",
      partialize: (state: LayoutState) => ({
        // Only persist the pane width, not the selected task or scroll positions
        detailPaneWidth: state.detailPaneWidth,
      }),
    }
  )
);
