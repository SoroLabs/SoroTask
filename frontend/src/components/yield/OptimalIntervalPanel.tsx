"use client";

import { useYieldStore } from "@/src/store/yieldStore";
import type { IntervalOutcome } from "@/src/lib/yield/optimizer";

/**
 * Optimal rebalance interval comparison (Issue #1249).
 *
 * Shows every candidate schedule side by side rather than only the winner: the
 * point users miss is that compounding more often is not monotonically better,
 * and a single recommended number does not teach that. Seeing daily net less
 * than monthly does.
 */

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function OutcomeRow({
  outcome,
  isOptimal,
  isCurrent,
}: {
  outcome: IntervalOutcome;
  isOptimal: boolean;
  isCurrent: boolean;
}) {
  const lost = outcome.netProfit < 0;

  return (
    <tr
      className={[
        "border-b border-white/5 last:border-0",
        isOptimal ? "bg-emerald-500/5" : "",
      ].join(" ")}
      data-testid={`interval-row-${outcome.frequency}`}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100">{outcome.label}</span>
          {isOptimal && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
              Optimal
            </span>
          )}
          {isCurrent && !isOptimal && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
              Current
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-500">
          every {outcome.intervalDays} day{outcome.intervalDays === 1 ? "" : "s"}
        </span>
      </td>

      <td className="px-3 py-2.5 text-right tabular-nums text-slate-200">
        {formatAmount(outcome.netFinal)}
      </td>

      {/* Fees are shown next to the net figure, because the gap between gross
          and net is the entire lesson of this panel. */}
      <td className="px-3 py-2.5 text-right tabular-nums text-amber-400/90">
        {formatAmount(outcome.totalFeesPaid)}
      </td>

      <td
        className={[
          "px-3 py-2.5 text-right tabular-nums font-semibold",
          lost ? "text-red-400" : "text-emerald-400",
        ].join(" ")}
      >
        {outcome.netApy.toFixed(2)}%
      </td>

      <td className="px-3 py-2.5 text-right">
        {outcome.depleted ? (
          <span className="text-[11px] font-semibold text-red-400">Depleted</span>
        ) : (
          <span className="text-[11px] text-slate-500">—</span>
        )}
      </td>
    </tr>
  );
}

export default function OptimalIntervalPanel() {
  const optimization = useYieldStore((s) => s.optimization);
  const breakEvenFee = useYieldStore((s) => s.breakEvenFee);
  const frequency = useYieldStore((s) => s.frequency);
  const applyOptimalInterval = useYieldStore((s) => s.applyOptimalInterval);

  if (!optimization || optimization.outcomes.length === 0) {
    return null;
  }

  const { optimal, current, improvementOverCurrent, allIntervalsUnprofitable } = optimization;
  const alreadyOptimal = optimal?.frequency === frequency;

  return (
    <section
      aria-labelledby="optimal-interval-heading"
      data-testid="optimal-interval-panel"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="optimal-interval-heading" className="text-lg font-bold text-white">
            Optimal rebalance interval
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Net yield after keeper and gas fees, for every schedule you could run.
          </p>
        </div>

        {optimal && !alreadyOptimal && (
          <button
            type="button"
            onClick={applyOptimalInterval}
            className="rounded-xl bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
          >
            Switch to {optimal.label}
          </button>
        )}
      </div>

      {/* The headline is the delta, not the winner: "monthly is best" is not
          actionable, "you are leaving 42 on the table" is. */}
      {allIntervalsUnprofitable ? (
        <p
          role="status"
          className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          At these fees no schedule beats simply holding. Automating this position
          would cost more than it earns.
        </p>
      ) : alreadyOptimal ? (
        <p
          role="status"
          className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        >
          You are already on the optimal schedule.
        </p>
      ) : (
        optimal &&
        current && (
          <p
            role="status"
            className="mb-4 rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-200"
          >
            Switching from {current.label} to {optimal.label} is worth{" "}
            <span className="font-bold">{formatAmount(improvementOverCurrent)}</span> over
            this horizon.
          </p>
        )
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">Schedule</th>
              <th className="px-3 py-2 text-right font-semibold">Net final</th>
              <th className="px-3 py-2 text-right font-semibold">Fees paid</th>
              <th className="px-3 py-2 text-right font-semibold">Net APY</th>
              <th className="px-3 py-2 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {optimization.outcomes.map((outcome) => (
              <OutcomeRow
                key={outcome.frequency}
                outcome={outcome}
                isOptimal={outcome.frequency === optimal?.frequency}
                isCurrent={outcome.frequency === frequency}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Keeper fees move with congestion, so the headroom before the current
          schedule turns negative is worth stating outright. */}
      <p className="mt-4 text-xs text-slate-400">
        At your current schedule, compounding stops being worth it above{" "}
        <span className="font-semibold text-slate-200">
          {formatAmount(breakEvenFee)}
        </span>{" "}
        in combined keeper and gas fees per execution.
      </p>
    </section>
  );
}
