'use client';

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useSocket, TaskSummary, TaskUpdate, KeeperMetrics, HealthStatus } from '../hooks/useSocket';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LogEntry {
  id: string;
  taskId: number;
  status: TaskSummary['status'];
  message: string;
  timestamp: string;
}

export interface TaskState {
  tasks: TaskSummary[];
  metrics: KeeperMetrics | null;
  health: HealthStatus | null;
  logs: LogEntry[];
  connected: boolean;
  /** IDs of tasks being optimistically added (not yet confirmed by server) */
  pendingIds: Set<number>;
}

type TaskAction =
  | { type: 'SYNC_TASKS'; tasks: TaskSummary[] }
  | { type: 'TASK_UPDATED'; update: TaskUpdate }
  | { type: 'SYNC_METRICS'; metrics: KeeperMetrics }
  | { type: 'SYNC_HEALTH'; health: HealthStatus }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'OPTIMISTIC_ADD'; task: TaskSummary }
  | { type: 'CONFIRM_TASK'; taskId: number }
  | { type: 'ROLLBACK_TASK'; taskId: number };

// ─── Reducer ────────────────────────────────────────────────────────────────

const MAX_LOGS = 100;

function logEntry(taskId: number, status: TaskSummary['status'], message: string): LogEntry {
  return { id: `${taskId}-${Date.now()}`, taskId, status, message, timestamp: new Date().toISOString() };
}

function tasksReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case 'SYNC_TASKS': {
      // Merge server state with any pending optimistic tasks
      const serverIds = new Set(action.tasks.map((t) => t.id));
      const pending = state.tasks.filter(
        (t) => state.pendingIds.has(t.id) && !serverIds.has(t.id)
      );
      return { ...state, tasks: [...action.tasks, ...pending] };
    }

    case 'TASK_UPDATED': {
      const updated = state.tasks.map((t) =>
        t.id === action.update.taskId
          ? { ...t, status: action.update.status, lastSuccessAt: action.update.lastSuccess ?? t.lastSuccessAt, lastError: action.update.error ?? t.lastError }
          : t
      );
      const newLog = logEntry(
        action.update.taskId,
        action.update.status,
        action.update.status === 'failed'
          ? `Task #${action.update.taskId} failed: ${action.update.error}`
          : `Task #${action.update.taskId} → ${action.update.status}`
      );
      return {
        ...state,
        tasks: updated,
        logs: [newLog, ...state.logs].slice(0, MAX_LOGS),
      };
    }

    case 'SYNC_METRICS':
      return { ...state, metrics: action.metrics };

    case 'SYNC_HEALTH':
      return { ...state, health: action.health };

    case 'SET_CONNECTED':
      return { ...state, connected: action.connected };

    case 'OPTIMISTIC_ADD': {
      const alreadyExists = state.tasks.some((t) => t.id === action.task.id);
      if (alreadyExists) return state;
      const newPending = new Set(state.pendingIds);
      newPending.add(action.task.id);
      return {
        ...state,
        tasks: [action.task, ...state.tasks],
        pendingIds: newPending,
      };
    }

    case 'CONFIRM_TASK': {
      const newPending = new Set(state.pendingIds);
      newPending.delete(action.taskId);
      return { ...state, pendingIds: newPending };
    }

    case 'ROLLBACK_TASK': {
      const newPending = new Set(state.pendingIds);
      newPending.delete(action.taskId);
      return {
        ...state,
        tasks: state.tasks.filter((t) => t.id !== action.taskId),
        pendingIds: newPending,
      };
    }

    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

interface TaskContextValue {
  state: TaskState;
  optimisticAdd: (task: TaskSummary) => void;
  confirmTask: (taskId: number) => void;
  rollbackTask: (taskId: number) => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────

const INITIAL_STATE: TaskState = {
  tasks: [],
  metrics: null,
  health: null,
  logs: [],
  connected: false,
  pendingIds: new Set(),
};

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(tasksReducer, INITIAL_STATE);

  // Track seen event signatures to drop duplicates
  const seenEvents = useRef(new Set<string>());
  const dedupe = useCallback((key: string) => {
    if (seenEvents.current.has(key)) return true;
    seenEvents.current.add(key);
    // Prune after 2000 entries
    if (seenEvents.current.size > 2000) {
      const arr = Array.from(seenEvents.current);
      seenEvents.current = new Set(arr.slice(-1000));
    }
    return false;
  }, []);

  useSocket({
    onConnect: () => dispatch({ type: 'SET_CONNECTED', connected: true }),
    onDisconnect: () => dispatch({ type: 'SET_CONNECTED', connected: false }),
    onTasks: (tasks) => dispatch({ type: 'SYNC_TASKS', tasks }),
    onTaskUpdated: (update: TaskUpdate) => {
      const key = `task:${update.taskId}:${update.status}:${update.lastSuccess ?? ''}`;
      if (!dedupe(key)) dispatch({ type: 'TASK_UPDATED', update });
    },
    onMetrics: (metrics) => dispatch({ type: 'SYNC_METRICS', metrics }),
    onHealth: (health) => dispatch({ type: 'SYNC_HEALTH', health }),
  });

  const optimisticAdd = useCallback((task: TaskSummary) => {
    dispatch({ type: 'OPTIMISTIC_ADD', task });
  }, []);

  const confirmTask = useCallback((taskId: number) => {
    dispatch({ type: 'CONFIRM_TASK', taskId });
  }, []);

  const rollbackTask = useCallback((taskId: number) => {
    dispatch({ type: 'ROLLBACK_TASK', taskId });
  }, []);

  const value = useMemo(
    () => ({ state, optimisticAdd, confirmTask, rollbackTask }),
    [state, optimisticAdd, confirmTask, rollbackTask]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTaskContext() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskContext must be used inside TaskProvider');
  return ctx;
}
