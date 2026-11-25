"use client";

import { useMemo } from "react";
import { FiDownload, FiRefreshCw } from "react-icons/fi";
import { InteractiveFinancialChart } from "@/src/components/financial-analytics/InteractiveFinancialChart";
import type { ChartDatum } from "@/src/components/financial-analytics/InteractiveFinancialChart";
import { useFinancialAnalytics } from "@/src/hooks/useFinancialAnalytics";
import { downloadCsv } from "@/src/lib/financial-analytics/csv";
import type { GasFeeCandle } from "@/src/lib/financial-analytics/types";

function isGasCandle(record: unknown): record is GasFeeCandle {
  return record !== null && typeof record === "object" && "open" in record;
}

function formatXlm(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM`;
}

export default function GasOptimizationEngine() {
  const { records, status, error, lastUpdatedAt, refresh } = useFinancialAnalytics("gas");
  const candles = useMemo(() => records.filter(isGasCandle), [records]);
  const candleChart: ChartDatum[] = candles.map((candle, index) => ({
    x: index,
    label: new Date(candle.timestamp).toLocaleString(),
    value: candle.close,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
  const savingRows = candles.reduce<Array<{ timestamp: string; value: number }>>((rows, candle) => {
    const accumulated = (rows.at(-1)?.value ?? 0) + (candle.batchSavingsXlm ?? 0);
    rows.push({ timestamp: candle.timestamp, value: accumulated });
    return rows;
  }, []);
  const depth = (candles.at(-1)?.depth ?? [])
    .slice()
    .sort((left, right) => left.priceXlm - right.priceXlm);
  const depthChart: ChartDatum[] = depth.map((level) => ({
    x: level.priceXlm,
    label: `${level.priceXlm} XLM`,
    value: level.cumulativeVolumeXlm,
  }));
  const latest = candles.at(-1);
  const exportRows = candles.flatMap((candle) => {
    const candleRow = {
      recordType: "gas_fee_candle",
      timestamp: candle.timestamp,
      openXlm: candle.open,
      highXlm: candle.high,
      lowXlm: candle.low,
      closeXlm: candle.close,
      volumeXlm: candle.volumeXlm,
      batchSavingsXlm: candle.batchSavingsXlm,
      depthPriceXlm: "",
      cumulativeDepthXlm: "",
    };
    return [
      candleRow,
      ...(candle.depth ?? []).map((level) => ({
        recordType: "liquidity_depth",
        timestamp: candle.timestamp,
        openXlm: "",
        highXlm: "",
        lowXlm: "",
        closeXlm: "",
        volumeXlm: "",
        batchSavingsXlm: "",
        depthPriceXlm: level.priceXlm,
        cumulativeDepthXlm: level.cumulativeVolumeXlm,
      })),
    ];
  });

  const statusMessage = error
    ? error
    : status === "connected"
      ? "Live WebSocket updates connected."
      : candles.length > 0
        ? "Historical data loaded. Live updates reconnect automatically when configured."
        : "Waiting for the analytics history feed.";

  return (
    <div
      className="space-y-6 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl backdrop-blur-md"
      data-testid="gas-optimization-engine-container"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Network Fee & Liquidity Analytics</h2>
          <p className="mt-1 text-sm text-slate-400">
            Historical Soroban inclusion-fee candles, liquidity depth and observed batching savings.
          </p>
          <p
            className={`mt-2 text-xs ${error ? "text-rose-300" : status === "connected" ? "text-emerald-300" : "text-amber-300"}`}
            role={error ? "alert" : "status"}
            data-testid="gas-feed-status"
          >
            {statusMessage}
            {lastUpdatedAt && ` Last update ${new Date(lastUpdatedAt).toLocaleTimeString()}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
          >
            <FiRefreshCw aria-hidden="true" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => downloadCsv("sorotask-gas-analytics.csv", exportRows)}
            disabled={exportRows.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FiDownload aria-hidden="true" /> Export CSV
          </button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric title="Latest inclusion fee" value={formatXlm(latest?.close)} />
        <Metric title="Latest observed range" value={latest ? `${formatXlm(latest.low)} – ${formatXlm(latest.high)}` : "—"} />
        <Metric
          title="Cumulative observed batch savings"
          value={savingRows.length ? formatXlm(savingRows.at(-1)?.value) : "—"}
        />
      </div>

      <InteractiveFinancialChart
        title="Soroban inclusion fee · OHLC"
        data={candleChart}
        variant="candlestick"
        valueLabel="Fee (XLM)"
        testId="gas-candlestick-chart"
        emptyMessage="No fee candles yet. Configure the analytics history endpoint to load recorded network data."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <InteractiveFinancialChart
          title="Cumulative batching savings"
          data={savingRows.map((row) => ({
            x: Date.parse(row.timestamp),
            label: new Date(row.timestamp).toLocaleString(),
            value: row.value,
          }))}
          color="#34d399"
          valueLabel="Savings (XLM)"
          testId="gas-savings-chart"
          emptyMessage="Savings history will appear when the feed includes batchSavingsXlm."
        />
        <InteractiveFinancialChart
          title="Latest liquidity depth"
          data={depthChart}
          variant="depth"
          color="#38bdf8"
          valueLabel="Cumulative volume (XLM)"
          testId="gas-depth-chart"
          emptyMessage="No liquidity depth snapshot is present in the latest feed record."
        />
      </div>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-950/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <p className="mt-2 break-words font-mono text-lg font-bold text-white">{value}</p>
    </div>
  );
}
