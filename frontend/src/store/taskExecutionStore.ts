/**
 * Task Execution Store (Zustand)
 * 
 * Manages the state of task execution events, logs, and status updates.
 * Automatically syncs with the task execution stream client.
 */

import { create } from 'zustand';
import {
  TaskExecutionState,
  TaskExecutionEvent,
  ExecutionLogEntry,
  ExecutionStatus,
  ExecutionTrace,
} from '@/src/types/taskExecution';

// Toast notification callback
let toastHandler: ((msg: string, type?: string) => void) | null = null;
export function setExecutionToastHandler(fn: (msg: string, type?: string) => void) {
  toastHandler = fn;
}

function showToast(msg: string, type = 'success') {
  toastHandler?.(msg, type);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExecutionStore {
  // State
  executions: Record<string, TaskExecutionState>;
  executionTraces: Record<string, ExecutionTrace>;
  streamConnected: boolean;
  lastEventId?: string;

  // Actions
  updateExecutionStatus: (taskId: string, status: ExecutionStatus) => void;
  addExecutionLog: (taskId: string, log: ExecutionLogEntry) => void;
  updateProgress: (taskId: string, current: number, total: number) => void;
  setExecutionError: (taskId: string, code: string, message: string) => void;
  completeExecution: (
    taskId: string,
    success: boolean,
    gasUsed: number,
    transactionId?: string,
  ) => void;
  initializeExecution: (taskId: string) => void;
  setStreamConnected: (connected: boolean) => void;
  getExecutionState: (taskId: string) => TaskExecutionState | null;
  getLogs: (taskId: string) => ExecutionLogEntry[];
  setExecutionTrace: (taskId: string, trace: ExecutionTrace) => void;
  getExecutionTrace: (taskId: string) => ExecutionTrace | null;
  clearExecution: (taskId: string) => void;
  clearAllExecutions: () => void;
}

// ── Initial state ─────────────────────────────────────────────────────────────

const createInitialExecutionState = (taskId: string): TaskExecutionState => ({
  taskId,
  status: 'pending',
  logs: [],
});

// ── Store ─────────────────────────────────────────────────────────────────────

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  executions: {},
  executionTraces: {},
  streamConnected: false,

  initializeExecution(taskId) {
    set((state) => {
      if (state.executions[taskId]) {
        return state; // Already initialized
      }
      return {
        executions: {
          ...state.executions,
          [taskId]: createInitialExecutionState(taskId),
        },
      };
    });
  },

  updateExecutionStatus(taskId, status) {
    const state = get();
    if (!state.executions[taskId]) {
      state.initializeExecution(taskId);
    }

    set((current) => {
      const execution = current.executions[taskId];
      if (!execution) return current;

      return {
        executions: {
          ...current.executions,
          [taskId]: {
            ...execution,
            status,
            startedAt: status === 'executing' ? new Date().toISOString() : execution.startedAt,
          },
        },
      };
    });
  },

  addExecutionLog(taskId, log) {
    const state = get();
    if (!state.executions[taskId]) {
      state.initializeExecution(taskId);
    }

    set((current) => {
      const execution = current.executions[taskId];
      if (!execution) return current;

      return {
        executions: {
          ...current.executions,
          [taskId]: {
            ...execution,
            logs: [...execution.logs, log].slice(-1000), // Keep last 1000 logs
          },
        },
      };
    });
  },

  updateProgress(taskId, current, total) {
    const state = get();
    if (!state.executions[taskId]) {
      state.initializeExecution(taskId);
    }

    set((current_state) => {
      const execution = current_state.executions[taskId];
      if (!execution) return current_state;

      return {
        executions: {
          ...current_state.executions,
          [taskId]: {
            ...execution,
            progress: { current, total },
          },
        },
      };
    });
  },

  setExecutionError(taskId, code, message) {
    const state = get();
    if (!state.executions[taskId]) {
      state.initializeExecution(taskId);
    }

    set((current) => {
      const execution = current.executions[taskId];
      if (!execution) return current;

      return {
        executions: {
          ...current.executions,
          [taskId]: {
            ...execution,
            status: 'failed',
            error: { code, message },
          },
        },
      };
    });
  },

  completeExecution(taskId, success, gasUsed, transactionId) {
    const state = get();
    if (!state.executions[taskId]) {
      state.initializeExecution(taskId);
    }

    set((current) => {
      const execution = current.executions[taskId];
      if (!execution) return current;

      // Show toast notification
      if (success) {
        showToast(`Task ${taskId} executed successfully!`);
      } else {
        showToast(`Task ${taskId} execution failed`, 'error');
      }

      return {
        executions: {
          ...current.executions,
          [taskId]: {
            ...execution,
            status: success ? 'completed' : 'failed',
            completedAt: new Date().toISOString(),
            gasUsed,
            transactionId,
          },
        },
      };
    });
  },

  setStreamConnected(connected) {
    set({ streamConnected: connected });
  },

  getExecutionState(taskId) {
    const state = get();
    return state.executions[taskId] || null;
  },

  getLogs(taskId) {
    const state = get();
    return state.executions[taskId]?.logs || [];
  },

  setExecutionTrace(taskId, trace) {
    set((state) => ({
      executionTraces: {
        ...state.executionTraces,
        [taskId]: trace,
      },
    }));
  },

  getExecutionTrace(taskId) {
    const state = get();
    return state.executionTraces[taskId] || null;
  },

  clearExecution(taskId) {
    set((state) => {
      const { [taskId]: _, ...rest } = state.executions;
      const { [taskId]: __, ...restTraces } = state.executionTraces;
      return { executions: rest, executionTraces: restTraces };
    });
  },

  clearAllExecutions() {
    set({ executions: {} });
  },
}));
