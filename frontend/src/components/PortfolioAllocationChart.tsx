"use client";

import { memo, useEffect, useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildAllocation, formatShare, formatUsdCents, parsePortfolioSnapshot, type AllocationSlice } from "@/src/lib/portfolio-allocation";

export interface PortfolioAllocationChartProps {
  snapshot?: unknown;
  status?: "loading" | "ready" | "error" | "not-configured" | "disconnected";
  onRetry?: () => void;
}

function useReducedMotion() {
  // Disable animation until the browser preference is known, also during SSR.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function SliceDetails({ slice }: { slice: AllocationSlice }) {
  return <><strong>{slice.symbol} · {formatShare(slice.share)}</strong>
    <p>{formatUsdCents(slice.totalCents)} total</p>
    <p className="text-xs text-slate-300">Active {formatUsdCents(slice.activeCents)} · Idle {formatUsdCents(slice.idleCents)}</p></>;
}

const dateLabel = (at: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(at));

export const PortfolioAllocationChart = memo(function PortfolioAllocationChart({ snapshot: raw, status = "ready", onRetry }: PortfolioAllocationChartProps) {
  const titleId = useId();
  const detailId = useId();
  const reduced = useReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const model = useMemo(() => {
    if (status !== "ready") return null;
    try {
      const snapshot = parsePortfolioSnapshot(raw);
      const allocation = buildAllocation(snapshot);
      const maximum = snapshot.history.reduce((max, point) => BigInt(point.totalUsdCents) > max ? BigInt(point.totalUsdCents) : max, 0n);
      return { snapshot, ...allocation, maximum, trend: snapshot.history.map((point) => ({ ...point,
        level: maximum ? Number(BigInt(point.totalUsdCents)) / Number(maximum) : 0 })) };
    } catch { return null; }
  }, [raw, status]);
  const selected = model?.slices.find((slice) => slice.assetId === selectedId);

  let stateMessage: string | null = null;
  if (status === "loading") stateMessage = "Loading portfolio allocation…";
  else if (status === "disconnected") stateMessage = "Connect a wallet to view its portfolio allocation.";
  else if (status === "not-configured") stateMessage = "Portfolio data is not available yet. A portfolio data source needs to be connected.";
  else if (status === "error" || !model) stateMessage = "Portfolio data could not be loaded. Please try again.";
  else if (!model.totalCents) stateMessage = "No valued assets in this portfolio yet.";

  return (
    <section aria-labelledby={titleId} aria-busy={status === "loading"} className="my-8 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-slate-100 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs uppercase tracking-widest text-slate-400">Capital overview</p>
          <h2 id={titleId} className="mt-1 text-xl font-semibold">Portfolio allocation</h2>
          <p className="mt-1 text-sm text-slate-300">Token distribution, active capital and idle balances</p></div>
        {model && status === "ready" && <div className="max-w-full text-right"><p className="break-all text-2xl font-semibold tabular-nums">{formatUsdCents(model.totalCents)}</p>
          <p className="text-xs text-slate-400">USD valuation · {new Date(model.snapshot.asOf).toLocaleString("en-US", { timeZone: "UTC" })} UTC</p></div>}
      </header>

      {stateMessage ? <div className="py-10 text-center">
        <p role={status === "error" || (status === "ready" && !model) ? "alert" : "status"} className="text-sm text-slate-300">{stateMessage}</p>
        {onRetry && (status === "error" || (status === "ready" && !model)) && <button type="button" onClick={onRetry}
          className="mt-4 rounded-lg border border-slate-500 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">Retry portfolio</button>}
      </div> : model && <>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="relative min-w-0">
            <div aria-hidden="true" className="h-72 w-full" data-testid="allocation-donut">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart accessibilityLayer={false}>
                  <Pie data={model.slices} dataKey="share" nameKey="symbol" cx="50%" cy="50%" innerRadius="58%" outerRadius="88%"
                    paddingAngle={model.slices.length > 1 ? 2 : 0} stroke="#0F172A" strokeWidth={2}
                    rootTabIndex={-1} isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-in-out"
                    onMouseEnter={(_, index) => setSelectedId(model.slices[index]?.assetId ?? null)}
                    onMouseLeave={() => setSelectedId(null)}>
                    {model.slices.map((slice) => <Cell key={slice.assetId} fill={slice.color} opacity={!selected || selected.assetId === slice.assetId ? 1 : 0.45} />)}
                  </Pie>
                  <Tooltip content={({ active, payload }) => {
                    const slice = payload?.[0]?.payload as AllocationSlice | undefined;
                    return active && slice ? <div className="rounded-lg border border-slate-500 bg-slate-950 p-3 text-sm shadow-xl"><SliceDetails slice={slice} /></div> : null;
                  }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="pointer-events-none absolute left-1/2 top-36 -translate-x-1/2 -translate-y-1/2 text-center">
              <p className="text-xs text-slate-400">Valued assets</p><p className="text-xl font-semibold">{model.rows.filter((row) => row.totalCents > 0n).length}</p>
            </div>
          </div>
          <div className="min-w-0">
            <dl className="mb-4 grid grid-cols-2 gap-3">
              <div className="min-w-0 rounded-xl bg-slate-800/70 p-3"><dt className="text-xs text-slate-300">Active capital</dt><dd className="mt-1 break-all font-semibold tabular-nums">{formatUsdCents(model.activeCents)}</dd></div>
              <div className="min-w-0 rounded-xl bg-slate-800/70 p-3"><dt className="text-xs text-slate-300">Idle capital</dt><dd className="mt-1 break-all font-semibold tabular-nums">{formatUsdCents(model.idleCents)}</dd></div>
            </dl>
            <ul aria-label="Token allocation details" className="space-y-1">
              {model.slices.map((slice) => <li key={slice.assetId}><button type="button" aria-pressed={selectedId === slice.assetId} aria-describedby={detailId}
                onFocus={() => setSelectedId(slice.assetId)} onBlur={() => setSelectedId(null)} onClick={() => setSelectedId(slice.assetId)}
                onMouseEnter={() => setSelectedId(slice.assetId)} onMouseLeave={() => setSelectedId(null)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
                <span className="min-w-0 flex-1 truncate">{slice.symbol}</span><span className="tabular-nums">{formatShare(slice.share)}</span>
              </button></li>)}
            </ul>
            <div id={detailId} aria-live="polite" className="mt-3 min-h-20 rounded-lg border border-slate-700 p-3 text-sm">
              {selected ? <SliceDetails slice={selected} /> : <p className="text-slate-400">Hover a segment or focus a token to inspect its USD valuation.</p>}
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-400">Valuations are supplied by the portfolio data source at the timestamp above. Active and idle amounts are mutually exclusive; unpriced assets must be omitted by the source.</p>

        <details className="mt-5 rounded-xl border border-slate-700 p-3">
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-sky-300">All assets and exact USD values ({model.rows.length})</summary>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs">
            <caption className="sr-only">Every asset, including assets grouped under Other assets and zero balances</caption>
            <thead><tr>{["Asset", "Allocation", "Active", "Idle", "Total"].map((title) => <th key={title} scope="col" className="px-2 py-2 text-slate-300">{title}</th>)}</tr></thead>
            <tbody>{model.rows.map((row) => <tr key={row.assetId} className="border-t border-slate-800">
              <th scope="row" className="max-w-52 break-words px-2 py-2 font-medium">{row.symbol}<span className="block text-slate-400">{row.name}</span><span className="block max-w-52 break-all text-slate-400">{row.assetId}</span></th>
              <td className="px-2 py-2 tabular-nums">{formatShare(row.share)}</td><td className="px-2 py-2 tabular-nums">{formatUsdCents(row.activeUsdCents)}</td>
              <td className="px-2 py-2 tabular-nums">{formatUsdCents(row.idleUsdCents)}</td><td className="px-2 py-2 tabular-nums">{formatUsdCents(row.totalCents)}</td>
            </tr>)}</tbody>
          </table></div>
        </details>

        <section className="mt-6 border-t border-slate-700 pt-5" aria-label="Historical portfolio value">
          <h3 className="text-sm font-semibold">Historical balance trend</h3>
          {model.trend.length < 2 ? <p className="mt-3 text-sm text-slate-400">Not enough history yet. At least two snapshots are needed to show a trend.</p> : <>
            <p className="mt-1 text-xs text-slate-400">{dateLabel(model.trend[0].at)} – {dateLabel(model.trend[model.trend.length - 1].at)} · USD valuations at each snapshot</p>
            <div aria-hidden="true" className="mt-3 h-40 w-full" data-testid="allocation-trend"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={model.trend} accessibilityLayer={false} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="at" tickFormatter={dateLabel} minTickGap={40} tick={{ fill: "#CBD5E1", fontSize: 11 }} />
                <YAxis hide domain={[0, 1]} />
                <Tooltip content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as { at: string; totalUsdCents: string } | undefined;
                  return active && point ? <div className="rounded-lg border border-slate-500 bg-slate-950 p-3 text-sm">{dateLabel(point.at)}<p>{formatUsdCents(point.totalUsdCents)}</p></div> : null;
                }} />
                <Area dataKey="level" type="linear" stroke="#56B4E9" fill="#56B4E9" fillOpacity={0.15} strokeWidth={2}
                  isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-in-out" />
              </AreaChart>
            </ResponsiveContainer></div>
            <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-sky-300">Historical values in USD</summary>
              <ul className="mt-2 grid gap-2 sm:grid-cols-3">{model.trend.map((point) => <li key={point.at}><time dateTime={point.at}>{new Date(point.at).toISOString().replace("T", " ").replace(".000Z", " UTC")}</time>: {formatUsdCents(point.totalUsdCents)}</li>)}</ul>
            </details>
          </>}
        </section>
      </>}
    </section>
  );
});

export default PortfolioAllocationChart;
