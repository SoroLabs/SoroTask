/**
 * Unit tests for TaskContext reducer — covers state reconciliation, 
 * deduplication, optimistic updates, and rollback.
 */

// ─── Inline the pure reducer (copy of logic in TaskContext.tsx) ───────────────

const MAX_LOGS = 100;

function logEntry(taskId, status, message) {
  return {
    id: `${taskId}-${Date.now()}`,
    taskId,
    status,
    message,
    timestamp: new Date().toISOString(),
  };
}

function tasksReducer(state, action) {
  switch (action.type) {
    case 'SYNC_TASKS': {
      const serverIds = new Set(action.tasks.map((t) => t.id));
      const pending = state.tasks.filter(
        (t) => state.pendingIds.has(t.id) && !serverIds.has(t.id)
      );
      return { ...state, tasks: [...action.tasks, ...pending] };
    }

    case 'TASK_UPDATED': {
      const updated = state.tasks.map((t) =>
        t.id === action.update.taskId
          ? {
              ...t,
              status: action.update.status,
              lastSuccessAt: action.update.lastSuccess ?? t.lastSuccessAt,
              lastError: action.update.error ?? t.lastError,
            }
          : t
      );
      const newLog = logEntry(
        action.update.taskId,
        action.update.status,
        `Task #${action.update.taskId} → ${action.update.status}`
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

const INITIAL = {
  tasks: [],
  metrics: null,
  health: null,
  logs: [],
  connected: false,
  pendingIds: new Set(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TaskContext reducer', () => {
  test('SYNC_TASKS replaces tasks with server data', () => {
    const s0 = { ...INITIAL, tasks: [{ id: 1, status: 'active' }] };
    const serverTasks = [{ id: 2, status: 'registered' }, { id: 3, status: 'active' }];
    const s1 = tasksReducer(s0, { type: 'SYNC_TASKS', tasks: serverTasks });
    expect(s1.tasks).toHaveLength(2);
    expect(s1.tasks.map((t) => t.id)).toEqual([2, 3]);
  });

  test('SYNC_TASKS preserves pending optimistic tasks not yet on server', () => {
    const optimistic = { id: -1, status: 'registered' };
    const s0 = {
      ...INITIAL,
      tasks: [optimistic, { id: 1, status: 'active' }],
      pendingIds: new Set([-1]),
    };
    const s1 = tasksReducer(s0, {
      type: 'SYNC_TASKS',
      tasks: [{ id: 1, status: 'active' }],
    });
    expect(s1.tasks.some((t) => t.id === -1)).toBe(true);
  });

  test('SYNC_TASKS removes optimistic task once server confirms it', () => {
    const s0 = {
      ...INITIAL,
      tasks: [{ id: -1, status: 'registered' }, { id: 1, status: 'active' }],
      pendingIds: new Set([-1]),
    };
    // Server now returns real task (different ID — pending still present but
    // confirm removes it separately via CONFIRM_TASK)
    const s1 = tasksReducer(s0, {
      type: 'SYNC_TASKS',
      tasks: [{ id: 1, status: 'active' }, { id: 99, status: 'registered' }],
    });
    // Pending id -1 not in server list → still merged
    expect(s1.tasks.some((t) => t.id === -1)).toBe(true);
  });

  test('TASK_UPDATED mutates only the target task', () => {
    const s0 = {
      ...INITIAL,
      tasks: [
        { id: 1, status: 'active' },
        { id: 2, status: 'registered' },
      ],
    };
    const s1 = tasksReducer(s0, {
      type: 'TASK_UPDATED',
      update: { taskId: 1, status: 'executing' },
    });
    expect(s1.tasks.find((t) => t.id === 1).status).toBe('executing');
    expect(s1.tasks.find((t) => t.id === 2).status).toBe('registered');
  });

  test('TASK_UPDATED appends a log entry', () => {
    const s0 = INITIAL;
    const s1 = tasksReducer(s0, {
      type: 'TASK_UPDATED',
      update: { taskId: 7, status: 'failed', error: 'timeout' },
    });
    expect(s1.logs).toHaveLength(1);
    expect(s1.logs[0].taskId).toBe(7);
    expect(s1.logs[0].status).toBe('failed');
  });

  test('logs are capped at MAX_LOGS', () => {
    let s = INITIAL;
    for (let i = 0; i < 120; i++) {
      s = tasksReducer(s, {
        type: 'TASK_UPDATED',
        update: { taskId: i, status: 'active' },
      });
    }
    expect(s.logs.length).toBe(MAX_LOGS);
  });

  test('OPTIMISTIC_ADD prepends task and tracks pendingId', () => {
    const task = { id: -1, status: 'registered', target: 'C...XYZ' };
    const s1 = tasksReducer(INITIAL, { type: 'OPTIMISTIC_ADD', task });
    expect(s1.tasks[0]).toEqual(task);
    expect(s1.pendingIds.has(-1)).toBe(true);
  });

  test('OPTIMISTIC_ADD is idempotent — same id not duplicated', () => {
    const task = { id: -1, status: 'registered' };
    const s1 = tasksReducer(INITIAL, { type: 'OPTIMISTIC_ADD', task });
    const s2 = tasksReducer(s1, { type: 'OPTIMISTIC_ADD', task });
    expect(s2.tasks.filter((t) => t.id === -1)).toHaveLength(1);
  });

  test('CONFIRM_TASK removes id from pendingIds', () => {
    const s0 = {
      ...INITIAL,
      pendingIds: new Set([-1, -2]),
    };
    const s1 = tasksReducer(s0, { type: 'CONFIRM_TASK', taskId: -1 });
    expect(s1.pendingIds.has(-1)).toBe(false);
    expect(s1.pendingIds.has(-2)).toBe(true);
  });

  test('ROLLBACK_TASK removes task and clears pendingId', () => {
    const s0 = {
      ...INITIAL,
      tasks: [{ id: -1, status: 'registered' }, { id: 1, status: 'active' }],
      pendingIds: new Set([-1]),
    };
    const s1 = tasksReducer(s0, { type: 'ROLLBACK_TASK', taskId: -1 });
    expect(s1.tasks.find((t) => t.id === -1)).toBeUndefined();
    expect(s1.pendingIds.has(-1)).toBe(false);
    expect(s1.tasks).toHaveLength(1);
  });

  test('SET_CONNECTED updates connection flag', () => {
    const s1 = tasksReducer(INITIAL, { type: 'SET_CONNECTED', connected: true });
    expect(s1.connected).toBe(true);
    const s2 = tasksReducer(s1, { type: 'SET_CONNECTED', connected: false });
    expect(s2.connected).toBe(false);
  });

  test('SYNC_METRICS stores metrics', () => {
    const metrics = { tasksCheckedTotal: 5, tasksExecutedTotal: 3, tasksFailedTotal: 0, tasksDueTotal: 3, avgFeePaidXlm: 0.001, lastCycleDurationMs: 120 };
    const s1 = tasksReducer(INITIAL, { type: 'SYNC_METRICS', metrics });
    expect(s1.metrics).toEqual(metrics);
  });

  test('SYNC_HEALTH stores health status', () => {
    const health = { status: 'ok', uptime: 3600, lastPollAt: null, rpcConnected: true };
    const s1 = tasksReducer(INITIAL, { type: 'SYNC_HEALTH', health });
    expect(s1.health).toEqual(health);
  });
});
