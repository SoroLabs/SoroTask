'use client';

/**
 * GanttTimeline — task execution schedule as a zoomable timeline (issue #873).
 *
 * Grid and list views cannot show overlap or schedule density; this lays every
 * task's executions on a shared time axis so both are visible at a glance.
 *
 * Schedule arithmetic lives in lib/ganttSchedule.ts so it can be tested
 * without rendering.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { Task, TaskExecution } from '@/types/task';
import { Modal, ModalFooter } from '@/components/Modal';
import {
  ZOOM_LEVELS,
  STATUS_COLORS,
  buildTimelineRows,
  buildTicks,
  blockKey,
  computeHourlyDensity,
  detectCollisions,
  executionsForBlock,
  positionPercent,
  rescheduleTask,
  type ScheduleBlock,
  type ZoomLevel,
} from '@/lib/ganttSchedule';

interface GanttTimelineProps {
  tasks: Task[];
  /** Historical runs. Anything after `now` is projected from each interval. */
  executions?: TaskExecution[];
  initialZoom?: ZoomLevel;
  onTaskSelect?: (task: Task) => void;
  /**
   * Called when a run is dragged to a new time. Omit to disable dragging.
   * Returning the updated task is not required — the view re-derives from props.
   */
  onReschedule?: (task: Task, nextExecutionTime: Date) => void;
}

/** Axis label formatting, tightened as the window narrows. */
function formatTick(at: number, zoom: ZoomLevel): string {
  const d = new Date(at);
  if (zoom === '1h' || zoom === '6h') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (zoom === '24h') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function GanttTimeline({
  tasks,
  executions = [],
  initialZoom = '24h',
  onTaskSelect,
  onReschedule,
}: GanttTimelineProps) {
  const [zoom, setZoom] = useState<ZoomLevel>(initialZoom);

  // Pinned per render pass rather than read inside the loop, so every row is
  // positioned against the same instant — otherwise blocks drift relative to
  // each other and to the "now" marker.
  const now = useMemo(() => Date.now(), [zoom, tasks, executions]);

  const windowMs = ZOOM_LEVELS.find((z) => z.value === zoom)?.windowMs ?? 86_400_000;

  // A quarter of the window behind now, so recent history is visible without
  // the upcoming schedule — the reason to open this view — being squeezed.
  const windowStart = now - windowMs * 0.25;
  const windowEnd = windowStart + windowMs;

  const rows = useMemo(
    () => buildTimelineRows(tasks, executions, windowStart, windowEnd, now),
    [tasks, executions, windowStart, windowEnd, now],
  );

  const ticks = useMemo(() => buildTicks(windowStart, windowEnd), [windowStart, windowEnd]);
  const nowPercent = positionPercent(now, windowStart, windowEnd);

  // Hourly density answers "when is this schedule busiest", which the block
  // list alone cannot show once rows are dense.
  const density = useMemo(
    () => computeHourlyDensity(rows, windowStart, windowEnd),
    [rows, windowStart, windowEnd],
  );

  // Blocks that run concurrently with another task, so overlap is visible
  // rather than inferred.
  const collisions = useMemo(() => detectCollisions(rows), [rows]);

  // --- drilldown --------------------------------------------------------
  const [drilldown, setDrilldown] = useState<{
    block: ScheduleBlock;
    task: Task;
    records: TaskExecution[];
  } | null>(null);

  const openDrilldown = useCallback(
    (block: ScheduleBlock, task: Task) => {
      setDrilldown({ block, task, records: executionsForBlock(block, executions) });
    },
    [executions],
  );

  // --- drag to reschedule ----------------------------------------------
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const endDrag = useCallback(() => {
    setDraggingId(null);
  }, []);

  const handleDrop = useCallback(
    (task: Task, clientX: number) => {
      const track = trackRef.current;
      if (!track || !onReschedule) return;

      const rect = track.getBoundingClientRect();
      if (rect.width === 0) return;

      // Convert the pointer position back to a timestamp. Clamped so a drop
      // just outside the track still lands on the nearest edge rather than
      // throwing the schedule far into the past or future.
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const droppedAt = windowStart + ratio * (windowEnd - windowStart);

      const result = rescheduleTask(task, droppedAt);
      if (result.nextExecutionTime) {
        onReschedule(result.task, result.nextExecutionTime);
      }
    },
    [onReschedule, windowStart, windowEnd],
  );

  return (
    <section
      className="rounded-xl border border-slate-700 bg-slate-900 p-4"
      aria-label="Task execution timeline"
    >
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-100">Execution timeline</h2>

        <div className="flex items-center gap-1" role="group" aria-label="Timeline zoom level">
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              onClick={() => setZoom(level.value)}
              aria-pressed={zoom === level.value}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                zoom === level.value
                  ? 'bg-slate-700 text-slate-50'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap gap-3">
        {(['active', 'pending', 'failed', 'paused'] as const).map((status) => (
          <span key={status} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-sm ${STATUS_COLORS[status].block}`} />
            {STATUS_COLORS[status].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-400" />
          Projected
        </span>
      </div>

      {/* Axis */}
      <div className="relative mb-1 ml-44 h-5 border-b border-slate-700">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2 text-[10px] text-slate-500"
            style={{ left: `${positionPercent(t, windowStart, windowEnd)}%` }}
          >
            {formatTick(t, zoom)}
          </span>
        ))}
      </div>

      {/* Hourly density: shows when the schedule is busiest, which individual
          rows cannot once runs are packed together. */}
      {rows.length > 0 && density.length > 0 ? (
        <div className="mt-3 flex items-center gap-2" data-testid="gantt-density">
          <span className="w-44 shrink-0 text-[11px] text-slate-500">Hourly density</span>
          <div className="flex h-3 flex-1 gap-px overflow-hidden rounded">
            {density.map((bucket) => (
              <div
                key={bucket.start}
                className="flex-1 bg-sky-500"
                style={{ opacity: bucket.count === 0 ? 0.08 : 0.2 + bucket.intensity * 0.8 }}
                title={`${new Date(bucket.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} — ${bucket.count} run${bucket.count === 1 ? '' : 's'}`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No tasks to display.</p>
      ) : (
        <div className="relative">
          {/* "Now" marker, drawn across all rows so overlap is readable
              against the present rather than against each row's own history. */}
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-10 ml-44 w-px bg-amber-400/70"
            style={{ left: `calc(${nowPercent}% )` }}
            aria-hidden="true"
          />

          <ul className="space-y-1">
            {rows.map(({ task, blocks, truncated }) => {
              const colors = STATUS_COLORS[task.status];
              return (
                <li key={task.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onTaskSelect?.(task)}
                    disabled={!onTaskSelect}
                    title={`${task.functionName} · ${task.contractAddress}`}
                    className="w-44 shrink-0 truncate rounded px-2 py-1 text-left text-xs text-slate-300 transition-colors enabled:hover:bg-slate-800 enabled:hover:text-slate-100 disabled:cursor-default"
                  >
                    <span className={colors.text}>●</span> {task.functionName}
                  </button>

                  <div
                    ref={trackRef}
                    onDragOver={(e) => {
                      if (!onReschedule) return;
                      e.preventDefault();
                      setDraggingId(task.id);
                    }}
                    onDragLeave={endDrag}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(task, e.clientX);
                      endDrag();
                    }}
                    className={`relative h-6 flex-1 rounded bg-slate-800/60 ${
                      draggingId === task.id ? 'ring-1 ring-sky-400' : ''
                    }`}
                    role="img"
                    aria-label={`${task.functionName}: ${blocks.length} execution${
                      blocks.length === 1 ? '' : 's'
                    } in view, status ${colors.label}${truncated ? ', list truncated' : ''}`}
                  >
                    {blocks.map((b) => {
                      const colliding = collisions.get(blockKey(b));
                      return (
                        <button
                          key={`${b.taskId}-${b.start}`}
                          type="button"
                          onClick={() => openDrilldown(b, task)}
                          // Colliding runs get a ring so concurrency is visible
                          // at a glance rather than needing a tooltip.
                          className={`absolute top-1 h-4 w-1.5 -translate-x-1/2 rounded-sm ${
                            colliding ? 'ring-1 ring-rose-400' : ''
                          } ${
                            b.isHistorical
                              ? b.outcome === 'failed'
                                ? STATUS_COLORS.failed.block
                                : colors.block
                              : `border border-dashed ${colors.block.replace('bg-', 'border-')} bg-transparent`
                          }`}
                          style={{ left: `${positionPercent(b.start, windowStart, windowEnd)}%` }}
                          title={`${new Date(b.start).toLocaleString()}${
                            b.isHistorical ? ` · ${b.outcome ?? 'ran'}` : ' · projected'
                          }${colliding ? ` · overlaps ${colliding.length} other task(s)` : ''}`}
                          aria-label={`Execution at ${new Date(b.start).toLocaleString()}${
                            colliding ? ', overlapping another task' : ''
                          }`}
                          data-testid="gantt-block"
                        />
                      );
                    })}

                    {truncated && (
                      <span className="absolute right-1 top-1 rounded bg-slate-700 px-1 text-[10px] text-slate-300">
                        capped
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-500">
        Solid blocks are recorded executions; dashed blocks are projected from each
        task&apos;s interval. Paused tasks project no upcoming runs. A
        <span className="mx-1 rounded bg-slate-700 px-1 text-rose-300">ring</span>
        marks a run overlapping another task. Click a block for its execution log, or
        drag a row to reschedule it. Rows marked
        <span className="mx-1 rounded bg-slate-700 px-1 text-slate-300">capped</span>
        have more executions in this window than can be usefully drawn.
      </p>

      {/* Historical drilldown: the block is only a marker, so the records
          behind it are fetched on demand rather than kept in the props. */}
      <Modal
        open={drilldown !== null}
        onClose={() => setDrilldown(null)}
        title="Execution detail"
        description={
          drilldown
            ? `${drilldown.task.functionName} · ${new Date(drilldown.block.start).toLocaleString()}`
            : undefined
        }
        size="md"
      >
        {drilldown ? (
          drilldown.records.length > 0 ? (
            <ul className="space-y-2" data-testid="gantt-drilldown-records">
              {drilldown.records.map((record) => (
                <li
                  key={record.id}
                  className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-slate-300">{record.id}</span>
                    <span
                      className={
                        record.status === 'failed' ? 'text-red-300' : 'text-emerald-300'
                      }
                    >
                      {record.status}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-400">{record.executedAt.toLocaleString()}</p>
                  {record.gasUsed !== undefined ? (
                    <p className="mt-1 text-slate-500">Gas: {record.gasUsed}</p>
                  ) : null}
                  {record.blockHash ? (
                    <p className="mt-1 break-all font-mono text-slate-500">{record.blockHash}</p>
                  ) : null}
                  {record.error ? (
                    <p className="mt-1 text-red-300">{record.error}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400" data-testid="gantt-drilldown-empty">
              This run was projected, so there is no execution record yet.
            </p>
          )
        ) : null}
      </Modal>
    </section>
  );
}

export default GanttTimeline;
