'use client';

import { useMemo } from 'react';
import {
  buildExplorerLink,
  deriveLifecycle,
  lifecycleProgress,
  summariseLifecycle,
  type LifecycleStage,
  type StageStatus,
} from '../lifecycle';
import { NETWORKS, type BridgeEvent, type CrossChainTask, type NetworkId } from '../types';

/**
 * Visual cross-chain message tracker (Issue #1252).
 *
 * Renders the message lifecycle as an ordered pipeline rather than a set of
 * per-chain badges. A user whose task has confirmed on the source and not yet
 * appeared on the destination needs to know which of those two facts is the
 * current state, and a status per chain cannot express the ordering between
 * them.
 */

const STATUS_STYLES: Record<StageStatus, { dot: string; text: string; label: string }> = {
  pending: { dot: 'bg-white/15', text: 'text-slate-500', label: 'Pending' },
  active: { dot: 'bg-sky-400 animate-pulse', text: 'text-sky-300', label: 'In progress' },
  complete: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Complete' },
  // Stalled is visually distinct from failed: it may still resolve, and
  // showing it as a failure sends the user to support prematurely.
  stalled: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Taking longer than usual' },
  failed: { dot: 'bg-red-500', text: 'text-red-300', label: 'Failed' },
};

function elapsed(from: string | undefined, now: number): string | null {
  if (!from) return null;
  const started = new Date(from).getTime();
  if (!Number.isFinite(started)) return null;

  const seconds = Math.max(0, Math.round((now - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function StageRow({
  stage,
  isLast,
  network,
  txHash,
  now,
}: {
  stage: LifecycleStage;
  isLast: boolean;
  network: NetworkId;
  txHash?: string;
  now: number;
}) {
  const style = STATUS_STYLES[stage.status];
  const link = buildExplorerLink(network, txHash);
  const age = stage.status === 'active' || stage.status === 'stalled'
    ? elapsed(stage.enteredAt, now)
    : null;

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0" data-testid={`stage-${stage.id}`}>
      {/* Connector, drawn behind the dot so a completed run reads as one line */}
      {!isLast && (
        <span
          aria-hidden="true"
          className={[
            'absolute left-[5px] top-4 h-full w-px',
            stage.status === 'complete' ? 'bg-emerald-400/40' : 'bg-white/10',
          ].join(' ')}
        />
      )}

      <span
        aria-hidden="true"
        className={`relative mt-1.5 size-2.5 shrink-0 rounded-full ${style.dot}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-slate-100">{stage.label}</span>
          <span className={`text-[11px] font-medium ${style.text}`}>{style.label}</span>
          {age && <span className="text-[11px] text-slate-500">· {age}</span>}
        </div>

        <p className="mt-0.5 text-xs text-slate-400">{stage.description}</p>

        {stage.error && (
          <p role="alert" className="mt-1 text-xs text-red-300">
            {stage.error}
          </p>
        )}

        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline"
          >
            View on {link.label}
          </a>
        )}
      </div>
    </li>
  );
}

export interface BridgeLifecycleTrackerProps {
  task: CrossChainTask;
  events: BridgeEvent[];
  /** Injectable for deterministic rendering in tests. */
  now?: number;
}

export default function BridgeLifecycleTracker({
  task,
  events,
  now = Date.now(),
}: BridgeLifecycleTrackerProps) {
  const taskEvents = useMemo(
    () => events.filter((e) => e.taskId === task.id),
    [events, task.id],
  );

  const stages = useMemo(() => deriveLifecycle(taskEvents, now), [taskEvents, now]);
  const progress = lifecycleProgress(stages);
  const summary = summariseLifecycle(stages);

  // The destination is Soroban by design; the source is whichever chain the
  // task originates on.
  const sourceNetwork = task.originNetwork;
  const destinationNetwork: NetworkId = 'soroban';

  const networkForStage = (stage: LifecycleStage): NetworkId =>
    stage.network === 'destination' ? destinationNetwork : sourceNetwork;

  const hashForStage = (stage: LifecycleStage): string | undefined => {
    if (stage.network === 'relay') return undefined;
    const target = networkForStage(stage);
    return task.chainStatuses[target]?.txHash;
  };

  return (
    <section
      aria-labelledby={`lifecycle-heading-${task.id}`}
      data-testid="bridge-lifecycle-tracker"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
    >
      <div className="mb-4">
        <h3
          id={`lifecycle-heading-${task.id}`}
          className="text-sm font-bold uppercase tracking-wider text-slate-300"
        >
          Message lifecycle
        </h3>

        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className={NETWORKS[sourceNetwork].color}>
            {NETWORKS[sourceNetwork].icon} {NETWORKS[sourceNetwork].label}
          </span>
          <span aria-hidden="true">&rarr;</span>
          <span className="text-slate-300">CCIP relay</span>
          <span aria-hidden="true">&rarr;</span>
          <span className={NETWORKS[destinationNetwork].color}>
            {NETWORKS[destinationNetwork].icon} {NETWORKS[destinationNetwork].label}
          </span>
        </p>

        {/* Announced politely: the state changes while the user is reading it,
            and an assertive announcement would interrupt them each time. */}
        <p
          role="status"
          aria-live="polite"
          data-testid="lifecycle-summary"
          className="mt-2 text-sm font-medium text-slate-200"
        >
          {summary}
        </p>

        <div
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Cross-chain progress"
        >
          <div
            className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <ol className="mt-4">
        {stages.map((stage, index) => (
          <StageRow
            key={stage.id}
            stage={stage}
            isLast={index === stages.length - 1}
            network={networkForStage(stage)}
            txHash={hashForStage(stage)}
            now={now}
          />
        ))}
      </ol>
    </section>
  );
}
