'use client';

/**
 * ProfitabilityCalculator — the keeper profitability workbench.
 *
 * Complements {@link KeeperProfitabilityChart}: the chart is a read-only
 * retrospective ("which keepers did well"), this is the forward-looking console
 * ("is the run I am about to start worth it, and how much fee headroom do I
 * have before it stops being").
 *
 * Every number on screen is derived from {@link projectMargin}, so the cost
 * breakdown the operator sees and the margin figure in the scatter plot can
 * never disagree — there is one model, called twice.
 */

import { useCallback, useMemo, useState } from 'react';
import { useKeeperProfitForecast, UseKeeperProfitForecastOptions } from '@/src/hooks/useKeeperProfitability';
import type { CostBreakdown } from '@/src/lib/keeper-profitability/costs';
import { projectMargin } from '@/src/lib/keeper-profitability/costs';
import { getTierStyle } from './profitabilityStyles';

export interface ProfitabilityCalculatorProps extends Omit<
  UseKeeperProfitForecastOptions,
  'gasPriceXlm'
> {
  /** Initial value of the gas-price override, in XLM per gas unit. */
  initialGasPriceXlm?: number;
  className?: string;
}

const FIELD_CLASS =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

const LABEL_CLASS = 'block text-xs font-medium uppercase tracking-wide text-slate-400';

/** Format an XLM amount with enough precision to stay useful near zero. */
function fmtXlm(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const digits = abs < 0.001 ? 6 : abs < 1 ? 4 : 2;
  return value.toFixed(digits);
}

function fmtPct(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function ProfitabilityCalculator({
  initialGasPriceXlm = 0.0001,
  className,
  ...options
}: ProfitabilityCalculatorProps) {
  const [workload, setWorkload] = useState({
    executions: options.workload.executions,
    gasPerTx: options.workload.gasPerTx,
    revenuePerSuccessXlm: options.workload.revenuePerSuccessXlm,
    successRate: options.workload.successRate,
  });
  const [usePool, setUsePool] = useState(Boolean(options.dex));
  const [reserveXlm, setReserveXlm] = useState(options.dex?.reserveXlm ?? 10_000);
  const [feeBps, setFeeBps] = useState(options.dex?.feeBps ?? 30);
  const [rpcCostPerHour, setRpcCostPerHour] = useState(options.rpc?.costPerHourXlm ?? 0);
  const [retryRate, setRetryRate] = useState(options.rpc?.retryRate ?? 0);
  const [manualGasPrice, setManualGasPrice] = useState<string | null>(null);

  const dex = usePool ? { reserveXlm, feeBps } : undefined;
  const rpc =
    rpcCostPerHour > 0
      ? { costPerHourXlm: rpcCostPerHour, executions: workload.executions, retryRate }
      : undefined;

  const forecast = useKeeperProfitForecast({
    ...options,
    workload,
    dex,
    rpc,
    gasPriceXlm: initialGasPriceXlm,
  });

  // A manual override has to win over the live feed, and it has to reach the
  // projection itself rather than only the displayed margin — otherwise the
  // override would change one number while the sweep and break-even silently
  // kept describing the live price.
  const override = manualGasPrice === null ? null : Number(manualGasPrice);
  const activeGasPrice = override !== null && Number.isFinite(override) ? override : null;

  const projected = useMemo(
    () =>
      projectMargin({
        workload,
        dex,
        rpc,
        gasPriceXlm: activeGasPrice ?? forecast.forecast.current ?? initialGasPriceXlm,
      }),
    [workload, dex, rpc, activeGasPrice, forecast.forecast.current, initialGasPriceXlm],
  );

  const current: CostBreakdown = projected;

  const setField = useCallback(
    <K extends keyof typeof workload>(key: K, value: number) => {
      setWorkload((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const tier = getTierStyle(current.tier);
  const headroom =
    forecast.breakEven !== null ? forecast.breakEven - forecast.forecast.current : null;

  return (
    <section
      data-testid="profitability-calculator"
      className={`space-y-6 ${className ?? ''}`}
      aria-labelledby="profitability-calculator-title"
    >
      <header className="flex flex-col gap-1">
        <h1
          id="profitability-calculator-title"
          className="text-2xl font-semibold text-slate-100"
        >
          Profitability Simulator
        </h1>
        <p className="text-sm text-slate-400">
          Net margin after gas, swap slippage, and RPC overhead — projected at the live
          base fee and re-costed across every fee window observed recently.
        </p>
      </header>

      {forecast.unavailable && (
        <p
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
        >
          Gas price feed unavailable. Projections use the last known value.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <fieldset className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-200">Workload</legend>

          <div>
            <label className={LABEL_CLASS} htmlFor="pc-executions">
              Executions
            </label>
            <input
              id="pc-executions"
              type="number"
              min={0}
              className={`mt-1 ${FIELD_CLASS}`}
              value={workload.executions}
              onChange={(e) => setField('executions', Number(e.target.value))}
            />
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="pc-gas-per-tx">
              Gas per execution
            </label>
            <input
              id="pc-gas-per-tx"
              type="number"
              min={0}
              className={`mt-1 ${FIELD_CLASS}`}
              value={workload.gasPerTx}
              onChange={(e) => setField('gasPerTx', Number(e.target.value))}
            />
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="pc-revenue">
              Reward per success (XLM)
            </label>
            <input
              id="pc-revenue"
              type="number"
              min={0}
              step="0.01"
              className={`mt-1 ${FIELD_CLASS}`}
              value={workload.revenuePerSuccessXlm}
              onChange={(e) => setField('revenuePerSuccessXlm', Number(e.target.value))}
            />
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="pc-success-rate">
              Success rate (%)
            </label>
            <input
              id="pc-success-rate"
              type="number"
              min={0}
              max={100}
              className={`mt-1 ${FIELD_CLASS}`}
              value={Math.round(workload.successRate * 100)}
              onChange={(e) => setField('successRate', Number(e.target.value) / 100)}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-200">Costs</legend>

          <div>
            <label className={LABEL_CLASS} htmlFor="pc-gas-price">
              Gas price override (XLM)
            </label>
            <input
              id="pc-gas-price"
              type="number"
              min={0}
              step="0.00001"
              placeholder={String(forecast.forecast.current)}
              className={`mt-1 ${FIELD_CLASS}`}
              value={manualGasPrice ?? ''}
              onChange={(e) => setManualGasPrice(e.target.value === '' ? null : e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              Leave blank to use the live feed (p50 {fmtXlm(forecast.forecast.p50)}).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="pc-use-pool"
              type="checkbox"
              checked={usePool}
              onChange={(e) => setUsePool(e.target.checked)}
            />
            <label htmlFor="pc-use-pool" className="text-sm text-slate-300">
              Model DEX slippage
            </label>
          </div>

          {usePool && (
            <>
              <div>
                <label className={LABEL_CLASS} htmlFor="pc-reserve">
                  Pool reserve (XLM)
                </label>
                <input
                  id="pc-reserve"
                  type="number"
                  min={0}
                  className={`mt-1 ${FIELD_CLASS}`}
                  value={reserveXlm}
                  onChange={(e) => setReserveXlm(Number(e.target.value))}
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor="pc-fee-bps">
                  Swap fee (bps)
                </label>
                <input
                  id="pc-fee-bps"
                  type="number"
                  min={0}
                  max={10_000}
                  className={`mt-1 ${FIELD_CLASS}`}
                  value={feeBps}
                  onChange={(e) => setFeeBps(Number(e.target.value))}
                />
              </div>
            </>
          )}

          <div>
            <label className={LABEL_CLASS} htmlFor="pc-rpc-cost">
              RPC cost per hour (XLM)
            </label>
            <input
              id="pc-rpc-cost"
              type="number"
              min={0}
              step="0.01"
              className={`mt-1 ${FIELD_CLASS}`}
              value={rpcCostPerHour}
              onChange={(e) => setRpcCostPerHour(Number(e.target.value))}
            />
          </div>

          {rpcCostPerHour > 0 && (
            <div>
              <label className={LABEL_CLASS} htmlFor="pc-retry-rate">
                Retry rate (%)
              </label>
              <input
                id="pc-retry-rate"
                type="number"
                min={0}
                max={100}
                className={`mt-1 ${FIELD_CLASS}`}
                value={Math.round(retryRate * 100)}
                onChange={(e) => setRetryRate(Number(e.target.value) / 100)}
              />
            </div>
          )}
        </fieldset>

        <div className="space-y-4">
          <div
            data-testid="pc-verdict"
            className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">Net margin</p>
            <p className={`mt-1 text-3xl font-semibold ${tier.text}`}>{fmtPct(current.margin)}</p>
            <p className="mt-1 text-sm text-slate-400">
              Verdict: <span className={tier.text}>{tier.label}</span>
            </p>
            <dl className="mt-4 space-y-1.5 text-sm">
              <Row label="Net profit" value={`${fmtXlm(current.netProfit)} XLM`} />
              <Row label="ROI" value={fmtPct(current.roi)} />
              <Row label="Gas" value={`${fmtXlm(current.gasCost)} XLM`} />
              <Row label="Slippage" value={`${fmtXlm(current.slippageCost)} XLM`} />
              <Row label="RPC" value={`${fmtXlm(current.rpcCost)} XLM`} />
            </dl>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <h2 className="text-xs uppercase tracking-wide text-slate-400">Fee headroom</h2>
            {forecast.breakEven === null ? (
              <p className="mt-1 text-sm text-rose-300">
                No break-even fee — this workload cannot cover its own costs.
              </p>
            ) : (
              <dl className="mt-2 space-y-1.5 text-sm">
                <Row label="Break-even fee" value={`${fmtXlm(forecast.breakEven)} XLM`} />
                <Row
                  label="Headroom"
                  value={headroom === null ? '—' : `${fmtXlm(headroom)} XLM`}
                />
                <Row
                  label="Margin at p95"
                  value={fmtPct(forecast.conservative.margin)}
                />
              </dl>
            )}
          </div>
        </div>
      </div>

      <section
        aria-labelledby="pc-sweep-title"
        className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"
      >
        <h2 id="pc-sweep-title" className="text-sm font-semibold text-slate-200">
          Margin across fee levels
        </h2>
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">
            Projected net margin for the configured workload at each simulated base fee
          </caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-1">
                Fee (XLM)
              </th>
              <th scope="col" className="py-1">
                Margin
              </th>
              <th scope="col" className="py-1">
                Net profit
              </th>
              <th scope="col" className="py-1">
                Verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {forecast.sweep.map((point) => {
              const style = getTierStyle(point.tier);
              return (
                <tr key={point.gasPriceXlm} className="border-t border-slate-800">
                  <td className="py-1.5 text-slate-300">{fmtXlm(point.gasPriceXlm)}</td>
                  <td className={`py-1.5 ${style.text}`}>{fmtPct(point.margin)}</td>
                  <td className="py-1.5 text-slate-300">{fmtXlm(point.netProfit)}</td>
                  <td className={`py-1.5 ${style.text}`}>{style.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section
        aria-labelledby="pc-history-title"
        className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"
      >
        <h2 id="pc-history-title" className="text-sm font-semibold text-slate-200">
          ROI across observed fee windows
        </h2>
        {forecast.history.windowCount === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            No fee history yet — projections will appear once samples arrive.
          </p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Row label="Windows" value={String(forecast.history.windowCount)} />
              <Row label="Mean ROI" value={fmtPct(forecast.history.meanRoi)} />
              <Row label="Worst ROI" value={fmtPct(forecast.history.minRoi)} />
              <Row
                label="Profitable share"
                value={fmtPct(forecast.history.profitableShare)}
              />
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Worst window occurred at a base fee of{' '}
              {fmtXlm(forecast.history.worstGasPriceXlm)} XLM.
            </p>
          </>
        )}
      </section>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-100">{value}</dd>
    </div>
  );
}

export default ProfitabilityCalculator;
