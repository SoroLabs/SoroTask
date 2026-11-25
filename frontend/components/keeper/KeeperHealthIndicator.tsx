'use client';

import type { HealthStatus } from '@/app/hooks/useSocket';

interface KeeperHealthIndicatorProps {
  connected: boolean;
  health: HealthStatus | null;
}

function getHealthScore(health: HealthStatus): number {
  const signals = [
    health.status === 'ok',
    health.rpcConnected,
    health.rpcCircuitState !== 'OPEN',
    health.paused !== true,
  ];

  return Math.round((signals.filter(Boolean).length / signals.length) * 100);
}

export function KeeperHealthIndicator({ connected, health }: KeeperHealthIndicatorProps) {
  if (!connected || !health) {
    return (
      <div
        className="rounded-2xl border border-slate-300 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
        role="status"
        aria-live="polite"
      >
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">System health</p>
        <p className="mt-2 text-2xl font-semibold text-slate-800 dark:text-slate-100">
          {!connected ? 'Telemetry disconnected' : 'Waiting for telemetry'}
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          A health score will appear when live keeper data is available.
        </p>
      </div>
    );
  }

  const score = getHealthScore(health);
  const isHealthy = score === 100;
  const statusLabel = isHealthy ? 'Healthy' : 'Degraded';
  const tone = isHealthy
    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
    : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';

  return (
    <div
      className={`rounded-2xl border p-6 shadow-sm ${tone}`}
      role="status"
      aria-live="polite"
      aria-label={`System health ${statusLabel}, score ${score} out of 100`}
    >
      <p className="text-sm font-medium opacity-80">System health</p>
      <div className="mt-2 flex items-baseline gap-3">
        <p className="text-4xl font-semibold tabular-nums">{score}</p>
        <span className="text-sm">/ 100</span>
        <span className="ml-auto rounded-full border border-current px-3 py-1 text-sm font-medium">
          {statusLabel}
        </span>
      </div>
      <p className="mt-2 text-sm opacity-80">
        Based on keeper heartbeat, RPC connectivity, circuit state, and pause status.
      </p>
    </div>
  );
}
