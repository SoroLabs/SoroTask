'use client';

/**
 * Rate Limiting & Anti-DDoS Frontend Shield — Dashboard.
 *
 * Top-level component wiring the {@link useShield} hook to the presentation
 * pieces. It is intentionally resilient: it renders meaningful empty states
 * before the first snapshot, surfaces worker health (off-main-thread vs
 * fallback), and never throws on absent data.
 */

import { useEffect } from 'react';
import { useShield, UseShieldOptions } from '@/src/hooks/useShield';
import { ThreatLevelGauge } from './ThreatLevelGauge';
import { ShieldMetrics } from './ShieldMetrics';
import { TopOffendersTable } from './TopOffendersTable';
import { AnomalyList } from './AnomalyList';
import type { RequestEvent } from '@/src/lib/shield/types';

export interface ShieldDashboardProps extends UseShieldOptions {
  /**
   * Optional live telemetry source. The dashboard re-submits whatever events
   * the host feeds it; when omitted the dashboard simply renders engine state.
   */
  events?: RequestEvent[];
  className?: string;
}

export function ShieldDashboard({ events, className, ...shieldOptions }: ShieldDashboardProps) {
  const { snapshot, health, ingest, reset } = useShield(shieldOptions);

  // Forward any externally supplied telemetry to the engine.
  useEffect(() => {
    if (events && events.length > 0) {
      ingest(events);
    }
  }, [events, ingest]);

  return (
    <section
      data-testid="shield-dashboard"
      className={`space-y-6 ${className ?? ''}`}
      aria-label="Rate limiting and anti-DDoS shield"
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Anti-DDoS Shield</h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time rate limiting and threat detection, processed off the main thread.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              health.offMainThread
                ? 'border-emerald-500/40 text-emerald-300'
                : 'border-amber-500/40 text-amber-300'
            }`}
            title={
              health.offMainThread
                ? 'Analysis running on a Web Worker'
                : 'Web Worker unavailable — using main-thread fallback'
            }
          >
            <span aria-hidden="true">●</span>
            {health.offMainThread ? 'Worker active' : 'Fallback mode'}
          </span>
          {health.recoveredErrors > 0 && (
            <span className="text-amber-300" title={health.lastError ?? undefined}>
              recovered ×{health.recoveredErrors}
            </span>
          )}
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-slate-600 px-3 py-1 text-slate-200 hover:bg-slate-800"
          >
            Reset
          </button>
        </div>
      </header>

      {!snapshot ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-8 text-center text-slate-400">
          Awaiting traffic telemetry…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <ThreatLevelGauge
              level={snapshot.threatLevel}
              requestsPerSecond={snapshot.requestsPerSecond}
            />
          </div>
          <div className="space-y-6 lg:col-span-2">
            <ShieldMetrics snapshot={snapshot} />
            <AnomalyList anomalies={snapshot.anomalies} />
          </div>
          <div className="lg:col-span-3">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Top traffic sources
            </h2>
            <TopOffendersTable offenders={snapshot.topOffenders} />
          </div>
        </div>
      )}
    </section>
  );
}

export default ShieldDashboard;
