import {
  blockKey,
  buildTimelineRows,
  computeHourlyDensity,
  detectCollisions,
  executionsForBlock,
  rescheduleTask,
  snapToSchedule,
} from '@/lib/ganttSchedule';
import type { Task, TaskExecution } from '@/types/task';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  contractAddress: 'C1',
  functionName: 'swap',
  interval: 3600,
  gasBalance: 10,
  createdAt: new Date(T0),
  status: 'active',
  ...over,
});

const exec = (over: Partial<TaskExecution> = {}): TaskExecution => ({
  id: 'e1',
  taskId: 't1',
  executedAt: new Date(T0),
  status: 'success',
  ...over,
});

/**
 * Historical-only rows: `now` sits past the window so nothing is projected.
 * Collision and density tests must not count projected runs, or they would
 * measure the schedule's cadence instead of its history.
 */
const historyOnly = (tasks: Task[], executions: TaskExecution[], spanHours = 2) =>
  buildTimelineRows(tasks, executions, T0 - HOUR, T0 + spanHours * HOUR, T0 + 10 * HOUR);

describe('execution drilldown', () => {
  it('carries the execution id on historical blocks', () => {
    const block = historyOnly([task()], [exec()])[0].blocks[0];
    expect(block.executionId).toBe('e1');
  });

  it('leaves projected blocks without an execution id', () => {
    const rows = buildTimelineRows(
      [task({ nextExecutionTime: new Date(T0 + HOUR) })],
      [],
      T0 - HOUR,
      T0 + 2 * HOUR,
      T0,
    );
    expect(rows[0].blocks.find((b) => !b.isHistorical)?.executionId).toBeUndefined();
  });

  it('resolves the record behind a block', () => {
    const found = executionsForBlock(
      { taskId: 't1', start: T0, isHistorical: true, executionId: 'e9' },
      [exec({ id: 'e9' })],
    );
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('e9');
  });

  it('returns nothing for an unknown execution id', () => {
    const found = executionsForBlock(
      { taskId: 't1', start: T0, isHistorical: true, executionId: 'nope' },
      [exec()],
    );
    expect(found).toHaveLength(0);
  });

  it('falls back to task and timestamp when no id is present', () => {
    const found = executionsForBlock(
      { taskId: 't1', start: T0, isHistorical: true },
      [exec()],
    );
    expect(found).toHaveLength(1);
  });

  it('returns nothing when no record matches', () => {
    const found = executionsForBlock(
      { taskId: 't1', start: T0 + 12_345, isHistorical: false },
      [exec()],
    );
    expect(found).toHaveLength(0);
  });
});

describe('detectCollisions', () => {
  it('flags runs from different tasks that land together', () => {
    const rows = historyOnly(
      [task({ id: 'a' }), task({ id: 'b' })],
      [
        exec({ id: 'ea', taskId: 'a' }),
        exec({ id: 'eb', taskId: 'b', executedAt: new Date(T0 + 500) }),
      ],
    );
    const collisions = detectCollisions(rows, 1000);

    expect(collisions.has(`a@${T0}`)).toBe(true);
    expect(collisions.has(`b@${T0 + 500}`)).toBe(true);
    expect(collisions.get(`a@${T0}`)).toContain('b');
  });

  it('ignores a single task firing twice in quick succession', () => {
    const rows = historyOnly(
      [task({ id: 'a' })],
      [exec({ id: 'e1', taskId: 'a' }), exec({ id: 'e2', taskId: 'a', executedAt: new Date(T0 + 100) })],
    );
    expect(detectCollisions(rows, 1000).size).toBe(0);
  });

  it('ignores well-separated runs', () => {
    const rows = historyOnly(
      [task({ id: 'a' }), task({ id: 'b' })],
      [
        exec({ id: 'ea', taskId: 'a' }),
        exec({ id: 'eb', taskId: 'b', executedAt: new Date(T0 + 5000) }),
      ],
    );
    expect(detectCollisions(rows, 1000).size).toBe(0);
  });

  it('honours a wider window', () => {
    const rows = historyOnly(
      [task({ id: 'a' }), task({ id: 'b' })],
      [
        exec({ id: 'ea', taskId: 'a' }),
        exec({ id: 'eb', taskId: 'b', executedAt: new Date(T0 + 5000) }),
      ],
    );
    expect(detectCollisions(rows, 10_000).size).toBe(2);
  });

  it('handles an empty schedule', () => {
    expect(detectCollisions(buildTimelineRows([], [], T0, T0 + HOUR, T0)).size).toBe(0);
  });

  it('builds a stable block key', () => {
    expect(blockKey({ taskId: 'x', start: 5, isHistorical: false })).toBe('x@5');
  });
});

describe('computeHourlyDensity', () => {
  const densityRows = () =>
    buildTimelineRows(
      [task({ id: 'a' })],
      [
        exec({ id: '1', taskId: 'a', executedAt: new Date(T0) }),
        exec({ id: '2', taskId: 'a', executedAt: new Date(T0 + 60_000) }),
        exec({ id: '3', taskId: 'a', executedAt: new Date(T0 + 2 * HOUR) }),
      ],
      T0,
      T0 + 3 * HOUR,
      T0 + 10 * HOUR,
    );

  it('emits one bucket per hour', () => {
    expect(computeHourlyDensity(densityRows(), T0, T0 + 3 * HOUR)).toHaveLength(3);
  });

  it('counts runs into the right hour', () => {
    const density = computeHourlyDensity(densityRows(), T0, T0 + 3 * HOUR);
    expect(density[0].count).toBe(2);
    expect(density[2].count).toBe(1);
  });

  it('scales intensity against the busiest bucket', () => {
    const density = computeHourlyDensity(densityRows(), T0, T0 + 3 * HOUR);
    expect(density[0].intensity).toBe(1);
    expect(density[2].intensity).toBe(0.5);
  });

  it('aligns bucket starts to the window', () => {
    expect(computeHourlyDensity(densityRows(), T0, T0 + 3 * HOUR)[1].start).toBe(T0 + HOUR);
  });

  it('yields zero intensity rather than NaN for an empty schedule', () => {
    const density = computeHourlyDensity([], T0, T0 + 2 * HOUR);
    expect(density.every((b) => b.intensity === 0)).toBe(true);
    expect(density).toHaveLength(2);
  });

  it('handles empty and inverted windows', () => {
    expect(computeHourlyDensity([], T0, T0)).toHaveLength(0);
    expect(computeHourlyDensity([], T0 + HOUR, T0)).toHaveLength(0);
  });

  it('excludes runs outside the window', () => {
    const outside = buildTimelineRows(
      [task({ id: 'a' })],
      [exec({ id: '1', taskId: 'a', executedAt: new Date(T0 - 5 * HOUR) })],
      T0,
      T0 + 2 * HOUR,
      T0 + 10 * HOUR,
    );
    expect(computeHourlyDensity(outside, T0, T0 + 2 * HOUR)[0].count).toBe(0);
  });
});

describe('snapToSchedule', () => {
  it('snaps forward to the next slot', () => {
    expect(snapToSchedule(T0 + 3_700_000, T0, 3_600_000)).toBe(T0 + HOUR);
  });

  it('snaps back to the previous slot', () => {
    expect(snapToSchedule(T0 + 100_000, T0, 3_600_000)).toBe(T0);
  });

  it('rounds to the nearer slot past the halfway point', () => {
    expect(snapToSchedule(T0 + 1_900_000, T0, 3_600_000)).toBe(T0 + HOUR);
  });

  it('leaves an exact slot alone', () => {
    expect(snapToSchedule(T0 + HOUR, T0, HOUR)).toBe(T0 + HOUR);
  });

  it('is a no-op for a non-positive interval', () => {
    expect(snapToSchedule(T0 + 5000, T0, 0)).toBe(T0 + 5000);
  });
});

describe('rescheduleTask', () => {
  it('snaps a drop onto the task schedule', () => {
    const t = task({ nextExecutionTime: new Date(T0 + HOUR) });
    const result = rescheduleTask(t, T0 + 2 * HOUR + 1000);
    expect(result.nextExecutionTime?.getTime()).toBe(T0 + 2 * HOUR);
  });

  it('returns an updated task without mutating the original', () => {
    const t = task({ nextExecutionTime: new Date(T0 + HOUR) });
    const result = rescheduleTask(t, T0 + 2 * HOUR);

    expect(result.task.nextExecutionTime?.getTime()).toBe(T0 + 2 * HOUR);
    expect(t.nextExecutionTime?.getTime()).toBe(T0 + HOUR);
  });

  it('treats a drop on the current slot as a no-op', () => {
    const t = task({ nextExecutionTime: new Date(T0) });
    const result = rescheduleTask(t, T0);

    expect(result.nextExecutionTime).toBeNull();
    expect(result.task).toBe(t);
  });

  it('anchors a task that has never run on its creation time', () => {
    const t = task({ nextExecutionTime: undefined, createdAt: new Date(T0) });
    const result = rescheduleTask(t, T0 + 2 * HOUR);
    expect(result.nextExecutionTime?.getTime()).toBe(T0 + 2 * HOUR);
  });

  it('does not produce an invalid date for a zero interval', () => {
    const t = task({ nextExecutionTime: new Date(T0), interval: 0 });
    const result = rescheduleTask(t, T0 + HOUR);

    expect(Number.isNaN(result.task.nextExecutionTime?.getTime() ?? NaN)).toBe(false);
  });
});

