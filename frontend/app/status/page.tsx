'use client';

import { useCallback, useRef, useState } from 'react';
import { KeeperHealthIndicator } from '@/components/keeper/KeeperHealthIndicator';
import { useSocket, type HealthStatus, type KeeperMetrics } from '../hooks/useSocket';

interface LedgerSample {
  sequence: number;
  recordedAt: number;
}

const REGIONS = ['North America', 'Europe', 'Asia Pacific'];

function formatNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat().format(value)
    : '—';
}

function formatDuration(value: number | null): string {
  return value === null ? '—' : `${value} ms`;
}

export default function StatusPage() {
  const [metrics, setMetrics] = useState<KeeperMetrics | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [ledgerRate, setLedgerRate] = useState<number | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const ledgerSamples = useRef<LedgerSample[]>([]);

  const handleHealth = useCallback((nextHealth: HealthStatus) => {
    setHealth(nextHealth);
    setLastUpdateAt(Date.now());

    const sequence = nextHealth.latestLedgerSequence;
    if (typeof sequence !== 'number' || !Number.isFinite(sequence)) {
      return;
    }

    const recordedAt = Date.now();
    const priorSample = ledgerSamples.current.at(-1);
    if (priorSample && sequence >= priorSample.sequence && recordedAt > priorSample.recordedAt) {
      const blocksPerMinute =
        ((sequence - priorSample.sequence) * 60_000) / (recordedAt - priorSample.recordedAt);
      setLedgerRate(Math.round(blocksPerMinute * 10) / 10);
    } else if (priorSample && sequence < priorSample.sequence) {
      setLedgerRate(null);
    }

    ledgerSamples.current = [
      ...ledgerSamples.current.filter((sample) => recordedAt - sample.recordedAt <= 60_000),
      { sequence, recordedAt },
    ].slice(-20);
  }, []);

  const handleMetrics = useCallback((nextMetrics: KeeperMetrics) => {
    setMetrics(nextMetrics);
    setLastUpdateAt(Date.now());
  }, []);

  useSocket({
    onConnect: () => setConnected(true),
    onDisconnect: () => setConnected(false),
    onHealth: handleHealth,
    onMetrics: handleMetrics,
    onLatency: setLatencyMs,
  });

  const warnings: string[] = [];
  if (!connected) {
    warnings.push('Live connection to the keeper is unavailable. Telemetry may be out of date.');
  } else if (health?.status === 'stale') {
    warnings.push('Keeper heartbeat is stale. Scheduled work may be delayed.');
  }
  if (health && !health.rpcConnected) {
    warnings.push('Keeper cannot currently reach its Stellar RPC endpoint.');
  }
  if (health?.rpcCircuitState === 'OPEN') {
    warnings.push('The RPC circuit breaker is open; keeper requests are being paused.');
  }
  if (health?.paused) {
    warnings.push(`Keeper is paused${health.pauseReason ? `: ${health.pauseReason}` : '.'}`);
  }

  const keeperEndpoints = connected ? 1 : 0;
  const updatedLabel = lastUpdateAt === null
    ? 'No live update received yet'
    : `Updated ${new Date(lastUpdateAt).toLocaleTimeString()}`;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">
            Network observability
          </p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">
            Keeper System Status
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Live keeper health, RPC latency, and recent ledger activity.
          </p>
        </div>
        <div
          className="flex items-center gap-2 text-sm"
          role="status"
          aria-live="polite"
          aria-label={`WebSocket ${connected ? 'connected' : 'disconnected'}`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-rose-500'}`}
            aria-hidden="true"
          />
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {connected ? 'Live updates connected' : 'Live updates disconnected'}
          </span>
        </div>
      </header>

      {warnings.length > 0 && (
        <section
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          role="alert"
          aria-labelledby="health-warning-heading"
        >
          <h2 id="health-warning-heading" className="font-semibold">Keeper attention required</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Live system metrics">
        <KeeperHealthIndicator connected={connected} health={health} />
        <MetricCard
          label="Keeper endpoints connected"
          value={`${keeperEndpoints} / 1`}
          detail="This dashboard's configured endpoint"
        />
        <MetricCard
          label="Keeper RPC latency"
          value={formatDuration(latencyMs)}
          detail="WebSocket round-trip to the keeper"
        />
        <MetricCard
          label="Recent ledger throughput"
          value={ledgerRate === null ? 'Collecting samples' : `${ledgerRate} blocks/min`}
          detail="Estimated from successive keeper ledger observations"
        />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Geographic latency matrix
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Regional probes are not currently published by the keeper service.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Regional data unavailable
            </span>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="sr-only">Keeper latency by geographic region</caption>
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-3 font-medium">Region</th>
                  <th scope="col" className="px-3 py-3 font-medium">Latency</th>
                  <th scope="col" className="px-3 py-3 font-medium">Health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {REGIONS.map((region) => (
                  <tr key={region}>
                    <th scope="row" className="px-3 py-3 font-medium text-slate-800 dark:text-slate-200">
                      {region}
                    </th>
                    <td className="px-3 py-3 text-slate-500 dark:text-slate-400">Not reported</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                        <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
                        No regional probe
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Keeper activity</h2>
          <dl className="mt-4 space-y-4">
            <MetricRow label="Tasks checked" value={formatNumber(metrics?.tasksCheckedTotal)} />
            <MetricRow label="Tasks executed" value={formatNumber(metrics?.tasksExecutedTotal)} />
            <MetricRow label="Tasks failed" value={formatNumber(metrics?.tasksFailedTotal)} />
            <MetricRow label="Last cycle duration" value={formatDuration(metrics?.lastCycleDurationMs ?? null)} />
            <MetricRow label="Latest ledger" value={formatNumber(health?.latestLedgerSequence)} />
          </dl>
          <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {updatedLabel}
          </p>
        </article>
      </section>
    </main>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</h2>
      <p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{detail}</p>
    </article>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}
