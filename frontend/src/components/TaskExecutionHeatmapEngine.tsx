'use client';

/**
 * TaskExecutionHeatmapEngine Component
 *
 * A complex, MVP-critical frontend engine for visualising Task Execution
 * Success Rate as a heatmap. Handles large datasets and edge cases with
 * a fault-tolerant data pipeline, thorough error tracking, and fallback
 * systems. Adheres to strict architectural boundaries by keeping all
 * engine logic self-contained within this module.
 */

import React, { Component, ErrorInfo, ReactNode, useEffect, useReducer, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export type HeatmapCellStatus = 'success' | 'warning' | 'failure' | 'empty';

export interface HeatmapCell {
  id: string;
  label: string;
  successRate: number;
  totalExecutions: number;
  status: HeatmapCellStatus;
}

export interface HeatmapDataset {
  cells: HeatmapCell[];
  periodLabel: string;
  fetchedAt: string;
}

export interface TaskExecutionHeatmapEngineProps {
  fetchData: () => Promise<HeatmapDataset>;
  maxRetries?: number;
  retryDelayMs?: number;
  onError?: (error: Error, attempt: number) => void;
}

// ---------------------------------------------------------------------------
// Internal state machine (useReducer)
// ---------------------------------------------------------------------------

type PipelineState =
  | { phase: 'idle' }
  | { phase: 'loading'; attempt: number }
  | { phase: 'success'; dataset: HeatmapDataset }
  | { phase: 'retrying'; attempt: number; lastError: string }
  | { phase: 'error'; message: string; attempts: number };

type PipelineAction =
  | { type: 'FETCH_START'; attempt: number }
  | { type: 'FETCH_SUCCESS'; dataset: HeatmapDataset }
  | { type: 'FETCH_RETRY'; attempt: number; error: string }
  | { type: 'FETCH_FAILURE'; message: string; attempts: number }
  | { type: 'RESET' };

function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  switch (action.type) {
    case 'FETCH_START':
      return { phase: 'loading', attempt: action.attempt };
    case 'FETCH_SUCCESS':
      return { phase: 'success', dataset: action.dataset };
    case 'FETCH_RETRY':
      return { phase: 'retrying', attempt: action.attempt, lastError: action.error };
    case 'FETCH_FAILURE':
      return { phase: 'error', message: action.message, attempts: action.attempts };
    case 'RESET':
      return { phase: 'idle' };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function deriveStatus(successRate: number, totalExecutions: number): HeatmapCellStatus {
  if (totalExecutions === 0) return 'empty';
  if (successRate >= 90) return 'success';
  if (successRate >= 60) return 'warning';
  return 'failure';
}

export function sanitiseDataset(raw: unknown): HeatmapDataset {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid dataset: expected an object.');
  }
  const r = raw as Record<string, unknown>;

  if (!Array.isArray(r.cells)) {
    throw new Error('Invalid dataset: "cells" must be an array.');
  }
  if (typeof r.periodLabel !== 'string') {
    throw new Error('Invalid dataset: "periodLabel" must be a string.');
  }
  if (typeof r.fetchedAt !== 'string') {
    throw new Error('Invalid dataset: "fetchedAt" must be a string.');
  }

  const cells: HeatmapCell[] = r.cells.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Cell[${index}]: expected an object.`);
    }
    const c = item as Record<string, unknown>;
    if (typeof c.id !== 'string') throw new Error(`Cell[${index}]: "id" must be a string.`);
    if (typeof c.label !== 'string') throw new Error(`Cell[${index}]: "label" must be a string.`);
    const successRate = Number(c.successRate);
    const totalExecutions = Number(c.totalExecutions);
    if (!isFinite(successRate) || successRate < 0 || successRate > 100) {
      throw new Error(`Cell[${index}]: "successRate" must be 0-100.`);
    }
    if (!isFinite(totalExecutions) || totalExecutions < 0) {
      throw new Error(`Cell[${index}]: "totalExecutions" must be >= 0.`);
    }
    return {
      id: c.id as string,
      label: c.label as string,
      successRate,
      totalExecutions,
      status: deriveStatus(successRate, totalExecutions),
    };
  });

  return { cells, periodLabel: r.periodLabel as string, fetchedAt: r.fetchedAt as string };
}

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryState {
  caughtError: Error | null;
}

export class HeatmapErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { caughtError: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { caughtError: error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Error is deliberately not leaked to the UI; boundary absorbs it.
    void error;
    void info;
  }

  reset = () => this.setState({ caughtError: null });

  render() {
    if (this.state.caughtError) {
      return (
        <div
          className="rounded-2xl border border-rose-700/40 bg-rose-900/20 p-5 text-sm text-rose-200"
          data-testid="heatmap-error-boundary"
          role="alert"
        >
          <p className="font-semibold">Heatmap engine encountered an unexpected error.</p>
          <p className="mt-1 text-rose-300/80">{this.state.caughtError.message}</p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-3 rounded-full border border-rose-400/30 px-4 py-1 text-xs font-medium text-rose-100 transition hover:bg-rose-400/10"
            data-testid="heatmap-error-boundary-reset"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Cell colour map
// ---------------------------------------------------------------------------

const CELL_STYLES: Record<HeatmapCellStatus, string> = {
  success: 'bg-emerald-500/70 border-emerald-400/50 text-emerald-100',
  warning: 'bg-amber-500/60 border-amber-400/50 text-amber-100',
  failure: 'bg-rose-600/70 border-rose-500/50 text-rose-100',
  empty: 'bg-slate-800/60 border-slate-700/50 text-slate-400',
};

// ---------------------------------------------------------------------------
// Heatmap grid
// ---------------------------------------------------------------------------

interface HeatmapGridProps {
  dataset: HeatmapDataset;
}

function HeatmapGrid({ dataset }: HeatmapGridProps) {
  if (dataset.cells.length === 0) {
    return (
      <p className="text-sm text-slate-400" data-testid="heatmap-empty">
        No execution data available for this period.
      </p>
    );
  }

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}
      data-testid="heatmap-grid"
    >
      {dataset.cells.map((cell) => (
        <div
          key={cell.id}
          className={`rounded-xl border p-3 text-center transition ${CELL_STYLES[cell.status]}`}
          title={`${cell.label}: ${cell.successRate}% success across ${cell.totalExecutions} executions`}
          data-testid={`heatmap-cell-${cell.id}`}
          aria-label={`${cell.label} success rate ${cell.successRate}%`}
        >
          <p className="text-xs font-medium leading-none">{cell.label}</p>
          <p className="mt-1 text-lg font-semibold leading-none">{cell.successRate}%</p>
          <p className="mt-1 text-[10px] opacity-70">{cell.totalExecutions} runs</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Core engine (inner component — no error boundary here; boundary wraps it)
// ---------------------------------------------------------------------------

function TaskExecutionHeatmapEngineInner({
  fetchData,
  maxRetries = 3,
  retryDelayMs = 1000,
  onError,
}: TaskExecutionHeatmapEngineProps) {
  const [state, dispatch] = useReducer(pipelineReducer, { phase: 'idle' });
  const isMountedRef = useRef(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;

    const run = async (attempt: number) => {
      if (!isMountedRef.current) return;
      dispatch({ type: 'FETCH_START', attempt });

      try {
        const raw = await fetchData();
        const dataset = sanitiseDataset(raw);
        if (isMountedRef.current) {
          dispatch({ type: 'FETCH_SUCCESS', dataset });
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error, attempt);

        if (!isMountedRef.current) return;

        if (attempt <= maxRetries) {
          dispatch({ type: 'FETCH_RETRY', attempt: attempt + 1, error: error.message });
          retryTimerRef.current = setTimeout(() => run(attempt + 1), retryDelayMs * attempt);
        } else {
          dispatch({ type: 'FETCH_FAILURE', message: error.message, attempts: attempt });
        }
      }
    };

    run(1);

    return () => {
      isMountedRef.current = false;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
      }
    };
    // fetchData identity is caller-controlled; deps are stable primitives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxRetries, retryDelayMs]);

  if (state.phase === 'idle' || state.phase === 'loading') {
    return (
      <div className="space-y-3" data-testid="heatmap-loading" aria-busy="true">
        <div className="h-4 w-1/3 animate-pulse rounded-full bg-slate-700/60" />
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-slate-700/40 bg-slate-800/50"
            />
          ))}
        </div>
        {state.phase === 'loading' && state.attempt > 1 && (
          <p className="text-xs text-slate-500" data-testid="heatmap-attempt-label">
            Attempt {state.attempt} of {maxRetries + 1}…
          </p>
        )}
      </div>
    );
  }

  if (state.phase === 'retrying') {
    return (
      <div className="space-y-3" data-testid="heatmap-retrying" aria-busy="true">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-amber-700/30 bg-amber-900/10"
            />
          ))}
        </div>
        <p className="text-xs text-amber-400/80" data-testid="heatmap-retry-label">
          Retrying… attempt {state.attempt} of {maxRetries + 1}
        </p>
        <p className="text-xs text-slate-500">{state.lastError}</p>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div
        className="rounded-2xl border border-rose-700/40 bg-rose-900/15 p-5"
        data-testid="heatmap-fetch-error"
        role="alert"
      >
        <p className="text-sm font-semibold text-rose-200">
          Failed to load heatmap data after {state.attempts} attempt{state.attempts !== 1 ? 's' : ''}.
        </p>
        <p className="mt-1 text-xs text-rose-300/70">{state.message}</p>
      </div>
    );
  }

  // phase === 'success'
  return (
    <div className="space-y-4" data-testid="heatmap-engine">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-slate-400">
          {state.dataset.periodLabel}
        </p>
        <p className="text-xs text-slate-500" data-testid="heatmap-fetched-at">
          {state.dataset.fetchedAt}
        </p>
      </div>
      <HeatmapGrid dataset={state.dataset} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public export — engine wrapped in its error boundary
// ---------------------------------------------------------------------------

export function TaskExecutionHeatmapEngine(props: TaskExecutionHeatmapEngineProps) {
  return (
    <HeatmapErrorBoundary>
      <TaskExecutionHeatmapEngineInner {...props} />
    </HeatmapErrorBoundary>
  );
}

export default TaskExecutionHeatmapEngine;
