/**
 * #879 — Global State Management Refactoring
 *
 * Refactored from a single flat Zustand store into logically separated slices,
 * each with explicit types, pure action creators, and deterministic ID
 * generation (crypto.randomUUID where available, with a fallback).
 *
 * Slice separation keeps each domain independent so slices can be split into
 * separate stores later without cascading changes across the app.
 *
 * Usage:
 *   // Selector — only re-renders when walletAddress changes
 *   const walletAddress = useAppStore((s) => s.walletAddress);
 *
 *   // Action — stable reference, will NOT cause re-renders by itself
 *   const addTask = useAppStore((s) => s.addTask);
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function genId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 10);
  return `${prefix}-${rand}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type TaskStatus = 'active' | 'paused' | 'completed' | 'failed' | 'pending';

export interface Task {
  id: string;
  target: string;
  functionName: string;
  interval: number;
  /** Gas balance in stroops. Keep contract token amounts as BigInt. */
  gasBalance: bigint;
}

export type LogStatus = 'Success' | 'Failed' | 'Pending';

export interface Log {
  id: string;
  taskId: string;
  target: string;
  keeper: string;
  status: LogStatus;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Slice interfaces
// ---------------------------------------------------------------------------

interface WalletSlice {
  isWalletConnected: boolean;
  walletAddress: string | null;
  /** Connect with a real address or a mock address for development. */
  connectWallet: (address?: string) => void;
  disconnectWallet: () => void;
}

interface TaskSlice {
  tasks: Task[];
  /** Add a task and return its generated id. */
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => string;
  /** Update mutable fields on an existing task. Noop if the task is not found. */
  updateTask: (id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>) => void;
  /** Remove a task by id. */
  removeTask: (id: string) => void;
  /** Convenience: reorder the tasks array (e.g. after drag-and-drop). */
  reorderTasks: (orderedIds: string[]) => void;
}

interface LogSlice {
  logs: Log[];
  /** Prepend a new log entry. */
  addLog: (log: Omit<Log, 'id' | 'timestamp'>) => void;
  /** Discard all log entries. */
  clearLogs: () => void;
}

// ---------------------------------------------------------------------------
// Combined store type
// ---------------------------------------------------------------------------

type AppState = WalletSlice & TaskSlice & LogSlice;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, _get) => ({
    // ------------------------------------------------------------------
    // Wallet slice
    // ------------------------------------------------------------------
    isWalletConnected: false,
    walletAddress: null,

    connectWallet: (address = 'GA32...XYZ9') =>
      set({ isWalletConnected: true, walletAddress: address }),

    disconnectWallet: () =>
      set({ isWalletConnected: false, walletAddress: null }),

    // ------------------------------------------------------------------
    // Task slice
    // ------------------------------------------------------------------
    tasks: [],

    addTask: (task) => {
      const id = genId('task');
      set((state) => ({
        tasks: [
          ...state.tasks,
          { ...task, id, status: task.status ?? 'pending', createdAt: nowISO() },
        ],
      }));
      return id;
    },

    updateTask: (id, patch) =>
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      })),

    removeTask: (id) =>
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
      })),

    reorderTasks: (orderedIds) =>
      set((state) => {
        const map = new Map(state.tasks.map((t) => [t.id, t]));
        const reordered = orderedIds.flatMap((id) => {
          const t = map.get(id);
          return t ? [t] : [];
        });
        // Append any tasks not mentioned in orderedIds at the end
        const mentioned = new Set(orderedIds);
        const remainder = state.tasks.filter((t) => !mentioned.has(t.id));
        return { tasks: [...reordered, ...remainder] };
      }),

    // ------------------------------------------------------------------
    // Log slice
    // ------------------------------------------------------------------
    logs: [
      {
        id: 'log-seed-1',
        taskId: '#1024',
        target: 'CC...A12B',
        keeper: 'GA...99X',
        status: 'Success',
        timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      },
    ],

    addLog: (log) =>
      set((state) => ({
        logs: [
          { ...log, id: genId('log'), timestamp: nowISO() },
          ...state.logs,
        ],
      })),

    clearLogs: () => set({ logs: [] }),
  }))
);

// ---------------------------------------------------------------------------
// Typed selector hooks (optional convenience — avoids inline arrow functions)
// ---------------------------------------------------------------------------

/** Subscribe to the wallet sub-state only. */
export const useWallet = () =>
  useAppStore((s) => ({
    isWalletConnected: s.isWalletConnected,
    walletAddress: s.walletAddress,
    connectWallet: s.connectWallet,
    disconnectWallet: s.disconnectWallet,
  }));

/** Subscribe to the full task list. */
export const useTasks = () => useAppStore((s) => s.tasks);

/** Subscribe to the full log list. */
export const useLogs = () => useAppStore((s) => s.logs);
