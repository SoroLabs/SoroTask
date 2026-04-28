import { timeTrackingReducer, initialState } from '../context/TimeTrackingContext';
import { Task, TimeEntry } from '../types';

describe('timeTrackingReducer', () => {
  it('adds a task', () => {
    const task: Task = {
      id: 'task-1',
      contractAddress: 'C123',
      functionName: 'test',
      interval: 3600,
      gasBalance: 10,
      createdAt: new Date(),
      totalTime: 0,
      timeEntries: [],
    };

    const action = { type: 'ADD_TASK' as const, payload: task };
    const newState = timeTrackingReducer(initialState, action);

    expect(newState.tasks).toHaveLength(1);
    expect(newState.tasks[0]).toEqual(task);
  });

  it('starts a timer for a task', () => {
    const task: Task = {
      id: 'task-1',
      contractAddress: 'C123',
      functionName: 'test',
      interval: 3600,
      gasBalance: 10,
      createdAt: new Date(),
      totalTime: 0,
      timeEntries: [],
    };
    const stateWithTask = { ...initialState, tasks: [task] };

    const action = { type: 'START_TIMER' as const, payload: { taskId: 'task-1' } };
    const newState = timeTrackingReducer(stateWithTask, action);

    expect(newState.activeTimer).toBeTruthy();
    expect(newState.activeTimer?.taskId).toBe('task-1');
    expect(newState.activeTimer?.isPaused).toBe(false);
  });

  it('stops an active timer and adds time entry', () => {
    const task: Task = {
      id: 'task-1',
      contractAddress: 'C123',
      functionName: 'test',
      interval: 3600,
      gasBalance: 10,
      createdAt: new Date(),
      totalTime: 0,
      timeEntries: [],
    };
    const startTime = new Date(Date.now() - 10000); // 10 seconds ago
    const stateWithActiveTimer = {
      ...initialState,
      tasks: [task],
      activeTimer: { taskId: 'task-1', startTime, isPaused: false },
    };

    const action = { type: 'STOP_TIMER' as const };
    const newState = timeTrackingReducer(stateWithActiveTimer, action);

    expect(newState.activeTimer).toBeNull();
    expect(newState.tasks[0].totalTime).toBe(10);
    expect(newState.tasks[0].timeEntries).toHaveLength(1);
    expect(newState.timeEntries).toHaveLength(1);
  });

  it('adds manual time entry', () => {
    const task: Task = {
      id: 'task-1',
      contractAddress: 'C123',
      functionName: 'test',
      interval: 3600,
      gasBalance: 10,
      createdAt: new Date(),
      totalTime: 0,
      timeEntries: [],
    };
    const stateWithTask = { ...initialState, tasks: [task] };

    const entry: TimeEntry = {
      id: 'manual-1',
      taskId: 'task-1',
      startTime: new Date(),
      duration: 1800, // 30 minutes
      isManual: true,
      description: 'Manual work',
    };

    const action = { type: 'ADD_TIME_ENTRY' as const, payload: entry };
    const newState = timeTrackingReducer(stateWithTask, action);

    expect(newState.tasks[0].totalTime).toBe(1800);
    expect(newState.tasks[0].timeEntries).toHaveLength(1);
    expect(newState.timeEntries).toHaveLength(1);
  });
});