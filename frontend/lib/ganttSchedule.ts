/**
 * Schedule projection for the Gantt timeline (issue #873).
 *
 * Kept separate from the component so the arithmetic — which is where the
 * bugs live — is testable without rendering anything.
 */

import type { Task, TaskExecution, TaskStatus } from '@/types/task';

export type ZoomLevel = '1h' | '6h' | '24h' | '7d' | '30d';

export const ZOOM_LEVELS: { value: ZoomLevel; label: string; windowMs: number }[] = [
  { value: '1h', label: '1 hour', windowMs: 60 * 60 * 1000 },
  { value: '6h', label: '6 hours', windowMs: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '24 hours', windowMs: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 days', windowMs: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: '30 days', windowMs: 30 * 24 * 60 * 60 * 1000 },
];

/**
 * Cap on projected blocks per task.
 *
 * A task running every 30 seconds over a 30-day window projects ~86,000
 * executions. Rendering those is both useless — they are sub-pixel at that
 * zoom — and enough DOM to lock the tab. Past the cap the row is marked
 * `truncated` so the UI can say so rather than silently lying about density.
 */
export const MAX_BLOCKS_PER_TASK = 300;

export interface ScheduleBlock {
  taskId: string;
  /** Milliseconds since epoch. */
  start: number;
  /** Whether this block already happened. */
  isHistorical: boolean;
  /** Outcome for historical blocks; projections have none yet. */
  outcome?: 'success' | 'failed' | 'pending';
  /** Id of the execution record, for historical blocks. Drives the drilldown. */
  executionId?: string;
}

export interface TaskRow {
  task: Task;
  blocks: ScheduleBlock[];
  /** True when projection hit MAX_BLOCKS_PER_TASK and stopped early. */
  truncated: boolean;
}

/** Tailwind classes per status, matching the palette the issue specifies. */
export const STATUS_COLORS: Record<TaskStatus, { block: string; label: string; text: string }> = {
  active: { block: 'bg-green-500', label: 'Active', text: 'text-green-400' },
  pending: { block: 'bg-blue-500', label: 'Pending', text: 'text-blue-400' },
  failed: { block: 'bg-red-500', label: 'Failed', text: 'text-red-400' },
  paused: { block: 'bg-gray-500', label: 'Paused', text: 'text-gray-400' },
  // Not in the issue's list, but the type has five variants and an unhandled
  // one would render as an invisible block.
  completed: { block: 'bg-slate-600', label: 'Completed', text: 'text-slate-400' },
};

/**
 * Project a task's execution times across `[windowStart, windowEnd]`.
 *
 * Paused tasks project nothing: a paused automation has no upcoming runs, and
 * drawing them would overstate scheduled load. Its history still renders.
 */
export function projectExecutions(
  task: Task,
  windowStart: number,
  windowEnd: number,
): { starts: number[]; truncated: boolean } {
  const intervalMs = task.interval * 1000;

  // A non-positive interval would make the loop below never advance. Treat it
  // as unschedulable rather than hanging the render.
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { starts: [], truncated: false };
  }
  if (task.status === 'paused' || task.status === 'completed') {
    return { starts: [], truncated: false };
  }

  const anchor = task.nextExecutionTime?.getTime() ?? task.createdAt.getTime();
  if (!Number.isFinite(anchor)) return { starts: [], truncated: false };

  // Step forward from the anchor to the first occurrence inside the window,
  // arithmetically rather than by looping — an anchor months in the past would
  // otherwise cost millions of iterations before producing anything visible.
  let first = anchor;
  if (anchor < windowStart) {
    const missed = Math.ceil((windowStart - anchor) / intervalMs);
    first = anchor + missed * intervalMs;
  }

  const starts: number[] = [];
  for (let t = first; t <= windowEnd; t += intervalMs) {
    if (starts.length >= MAX_BLOCKS_PER_TASK) {
      return { starts, truncated: true };
    }
    starts.push(t);
  }
  return { starts, truncated: false };
}

/**
 * Build the rendered rows for a set of tasks.
 *
 * Historical executions come from real records; anything after `now` is a
 * projection. The two are distinguished so the UI can render certainty
 * differently from prediction.
 */
export function buildTimelineRows(
  tasks: Task[],
  executions: TaskExecution[],
  windowStart: number,
  windowEnd: number,
  now: number = Date.now(),
): TaskRow[] {
  const historyByTask = new Map<string, TaskExecution[]>();
  for (const e of executions) {
    const at = e.executedAt.getTime();
    if (at < windowStart || at > windowEnd) continue;
    historyByTask.set(e.taskId, [...(historyByTask.get(e.taskId) ?? []), e]);
  }

  return tasks.map((task) => {
    const blocks: ScheduleBlock[] = (historyByTask.get(task.id) ?? []).map((e) => ({
      taskId: task.id,
      start: e.executedAt.getTime(),
      isHistorical: true,
      outcome: e.status,
      executionId: e.id,
    }));

    // Project only forward of now; the past is covered by real records, and
    // overlaying a projection on top would double-count executions that
    // actually happened.
    const projectFrom = Math.max(windowStart, now);
    if (projectFrom <= windowEnd) {
      const { starts, truncated } = projectExecutions(task, projectFrom, windowEnd);
      for (const start of starts) {
        blocks.push({ taskId: task.id, start, isHistorical: false });
      }
      blocks.sort((a, b) => a.start - b.start);
      return { task, blocks, truncated };
    }

    blocks.sort((a, b) => a.start - b.start);
    return { task, blocks, truncated: false };
  });
}

/** Position of a timestamp within the window, as a 0–100 percentage. */
export function positionPercent(at: number, windowStart: number, windowEnd: number): number {
  const span = windowEnd - windowStart;
  if (span <= 0) return 0;
  return ((at - windowStart) / span) * 100;
}

/** Evenly spaced tick marks for the time axis. */
export function buildTicks(windowStart: number, windowEnd: number, count = 6): number[] {
  const span = windowEnd - windowStart;
  if (span <= 0 || count < 2) return [windowStart];
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => windowStart + i * step);
}

// ---------------------------------------------------------------------------
// Collision detection, density and rescheduling (issue #1246)
// ---------------------------------------------------------------------------

/**
 * Two runs closer together than this are treated as concurrent.
 *
 * Not zero: blocks are rendered as 1.5px markers, so runs a few seconds apart
 * already overlap visually. One second keeps the highlight meaningful without
 * flagging every pair of back-to-back runs.
 */
export const COLLISION_WINDOW_MS = 1000;

/** Stable key for a block, used to look up its collision state. */
export function blockKey(block: ScheduleBlock): string {
  return `${block.taskId}@${block.start}`;
}

/**
 * Find runs from *different* tasks that land within `windowMs` of each other.
 *
 * Only cross-task pairs are reported: a single task firing twice in quick
 * succession is its own cadence, not a scheduling conflict.
 *
 * O(B log B + C) where C is the number of reported collisions.
 */
export function detectCollisions(
  rows: TaskRow[],
  windowMs: number = COLLISION_WINDOW_MS,
): Map<string, string[]> {
  const all = rows
    .flatMap((row) => row.blocks)
    .slice()
    .sort((a, b) => a.start - b.start);

  const collisions = new Map<string, string[]>();

  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      // Sorted by start, so once the gap exceeds the window no later block can
      // collide with this one either.
      if (all[j].start - all[i].start > windowMs) break;
      if (all[j].taskId === all[i].taskId) continue;

      push(collisions, blockKey(all[i]), all[j].taskId);
      push(collisions, blockKey(all[j]), all[i].taskId);
    }
  }

  return collisions;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    if (!existing.includes(value)) existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

export interface DensityBucket {
  /** Bucket start, milliseconds since epoch. */
  start: number;
  /** Number of runs starting in this bucket. */
  count: number;
  /** 0–1, relative to the busiest bucket. 0 when nothing ran. */
  intensity: number;
}

/**
 * Bucket every run in the window by hour, so the view can show when the
 * schedule is busiest rather than only how much of it there is.
 *
 * Returns one bucket per hour across the window, including empty ones, so the
 * x-axis stays evenly spaced.
 */
export function computeHourlyDensity(
  rows: TaskRow[],
  windowStart: number,
  windowEnd: number,
): DensityBucket[] {
  const hourMs = 60 * 60 * 1000;
  const span = windowEnd - windowStart;
  if (span <= 0) return [];

  const bucketCount = Math.ceil(span / hourMs);
  const counts = new Array<number>(bucketCount).fill(0);

  for (const row of rows) {
    for (const block of row.blocks) {
      if (block.start < windowStart || block.start > windowEnd) continue;
      const index = Math.floor((block.start - windowStart) / hourMs);
      if (index >= 0 && index < bucketCount) counts[index] += 1;
    }
  }

  const peak = counts.reduce((max, count) => (count > max ? count : max), 0);

  return counts.map((count, index) => ({
    start: windowStart + index * hourMs,
    count,
    // Guard the division so an empty schedule yields 0, not NaN.
    intensity: peak > 0 ? count / peak : 0,
  }));
}

/**
 * Snap a dragged timestamp onto the task's own run grid.
 *
 * Rescheduling to an arbitrary instant would break the interval the keeper
 * relies on, so a drop is rounded to the nearest slot anchored on the task's
 * existing schedule.
 */
export function snapToSchedule(
  at: number,
  anchor: number,
  intervalMs: number,
): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return at;
  const steps = Math.round((at - anchor) / intervalMs);
  return anchor + steps * intervalMs;
}

export type RescheduleResult = {
  /** The task with its next run moved; unchanged input when nothing moved. */
  task: Task;
  /** New next-run time, or null when the drop was a no-op. */
  nextExecutionTime: Date | null;
};

/**
 * Apply a drag-and-drop move to a task.
 *
 * The anchor is the task's current next run when it has one, otherwise its
 * creation time, so a task that has never run still lands on a valid slot
 * rather than an arbitrary time.
 */
export function rescheduleTask(task: Task, droppedAt: number): RescheduleResult {
  const anchor = task.nextExecutionTime?.getTime() ?? task.createdAt.getTime();
  const intervalMs = task.interval * 1000;
  const snapped = snapToSchedule(droppedAt, anchor, intervalMs);

  if (!Number.isFinite(snapped) || snapped === anchor) {
    return { task, nextExecutionTime: null };
  }

  return {
    task: { ...task, nextExecutionTime: new Date(snapped) },
    nextExecutionTime: new Date(snapped),
  };
}

/**
 * Execution records behind a block, for the drilldown view.
 * Projected blocks have no record and return an empty list.
 */
export function executionsForBlock(
  block: ScheduleBlock,
  executions: TaskExecution[],
): TaskExecution[] {
  if (block.executionId) {
    const match = executions.find((e) => e.id === block.executionId);
    return match ? [match] : [];
  }
  return executions.filter((e) => e.taskId === block.taskId && e.executedAt.getTime() === block.start);
}

