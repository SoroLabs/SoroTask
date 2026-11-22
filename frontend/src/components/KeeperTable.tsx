"use client";

import { useMemo, useState } from "react";

export type KeeperTier = "bronze" | "silver" | "gold" | "platinum";

export interface KeeperSlashingIncident {
  occurredAt: string;
  reason: string;
  transactionHash: string;
}

export interface KeeperRecord {
  id: string;
  address: string;
  tier: KeeperTier;
  stakeXlm: number;
  totalExecutions: number;
  successfulExecutions: number;
  uptimePercent: number;
  averageLatencyMs: number;
  gasSpentXlm: number;
  revenueXlm: number;
  slashingIncidents: KeeperSlashingIncident[];
  slaCertificate?: {
    issuer: string;
    validUntil: string;
    transactionHash: string;
  };
}

type SortKey = "totalExecutions" | "uptimePercent" | "averageLatencyMs" | "stakeXlm";

interface KeeperTableProps {
  keepers: KeeperRecord[];
  loading?: boolean;
  walletAddress?: string;
  onDelegate?: (keeper: KeeperRecord) => void;
}

const TIERS: KeeperTier[] = ["bronze", "silver", "gold", "platinum"];
const TX_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function explorerUrl(hash: string) {
  return TX_HASH_PATTERN.test(hash)
    ? `https://stellar.expert/explorer/futurenet/tx/${hash}`
    : null;
}

export function KeeperTable({
  keepers,
  loading = false,
  walletAddress,
  onDelegate,
}: KeeperTableProps) {
  const [tierFilter, setTierFilter] = useState<KeeperTier | "all">("all");
  const [maxLatency, setMaxLatency] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalExecutions");
  const [sortDescending, setSortDescending] = useState(true);

  const filteredKeepers = useMemo(() => {
    const latencyLimit = maxLatency === "" ? Number.POSITIVE_INFINITY : Number(maxLatency);
    return keepers
      .filter((keeper) => tierFilter === "all" || keeper.tier === tierFilter)
      .filter((keeper) => keeper.averageLatencyMs <= latencyLimit)
      .slice()
      .sort((a, b) => {
        const difference = a[sortKey] - b[sortKey];
        return sortDescending ? -difference : difference;
      });
  }, [keepers, maxLatency, sortDescending, sortKey, tierFilter]);

  const changeSort = (key: SortKey) => {
    if (sortKey === key) setSortDescending((current) => !current);
    else {
      setSortKey(key);
      setSortDescending(true);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/70">
      <div className="flex flex-col gap-4 border-b border-neutral-800 p-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Keeper leaderboard</h2>
          <p className="mt-1 text-sm text-neutral-400">
            {keepers.length} keeper{keepers.length === 1 ? "" : "s"} reported by the keeper service
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-xs text-neutral-400">
            Staking tier
            <select
              value={tierFilter}
              onChange={(event) => setTierFilter(event.target.value as KeeperTier | "all")}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
            >
              <option value="all">All tiers</option>
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>{tier[0].toUpperCase() + tier.slice(1)}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-neutral-400">
            Max latency (ms)
            <input
              type="number"
              min="0"
              value={maxLatency}
              onChange={(event) => setMaxLatency(event.target.value)}
              placeholder="Any"
              className="w-32 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
            />
          </label>
        </div>
      </div>

      {loading && (
        <p role="status" className="p-6 text-sm text-neutral-400">Loading keeper metrics…</p>
      )}
      {!loading && keepers.length === 0 && (
        <p className="p-8 text-center text-sm text-neutral-400">
          No keeper metrics are available. Configure the keeper leaderboard API to show live nodes.
        </p>
      )}
      {!loading && keepers.length > 0 && filteredKeepers.length === 0 && (
        <p className="p-8 text-center text-sm text-neutral-400">No keepers match these filters.</p>
      )}
      {!loading && filteredKeepers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-neutral-950/70 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th scope="col" className="px-4 py-3">Keeper</th>
                <th scope="col" className="px-4 py-3">Tier</th>
                <th scope="col" className="px-4 py-3">Stake</th>
                <th scope="col" className="px-4 py-3">
                  <button type="button" onClick={() => changeSort("totalExecutions")}>Executions ↕</button>
                </th>
                <th scope="col" className="px-4 py-3">
                  <button type="button" onClick={() => changeSort("uptimePercent")}>Uptime ↕</button>
                </th>
                <th scope="col" className="px-4 py-3">
                  <button type="button" onClick={() => changeSort("averageLatencyMs")}>Avg. latency ↕</button>
                </th>
                <th scope="col" className="px-4 py-3">Gas / revenue</th>
                <th scope="col" className="px-4 py-3">Slashing</th>
                <th scope="col" className="px-4 py-3">SLA</th>
                <th scope="col" className="px-4 py-3 text-right">Delegation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filteredKeepers.map((keeper) => {
                const certificateActive =
                  keeper.slaCertificate &&
                  Date.parse(keeper.slaCertificate.validUntil) > Date.now();
                const successRate = keeper.totalExecutions
                  ? (keeper.successfulExecutions / keeper.totalExecutions) * 100
                  : 0;
                return (
                  <tr key={keeper.id} className="align-top hover:bg-neutral-800/30">
                    <td className="px-4 py-4">
                      <span className="block font-medium text-neutral-100">{keeper.id}</span>
                      <span className="mt-1 block font-mono text-xs text-neutral-500">{keeper.address}</span>
                      <span className="mt-1 block text-xs text-neutral-400">{numberFormat.format(successRate)}% successful</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 py-1 text-xs capitalize text-blue-200">
                        {keeper.tier}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">{numberFormat.format(keeper.stakeXlm)} XLM</td>
                    <td className="px-4 py-4">{numberFormat.format(keeper.totalExecutions)}</td>
                    <td className="px-4 py-4">{numberFormat.format(keeper.uptimePercent)}%</td>
                    <td className="px-4 py-4">{numberFormat.format(keeper.averageLatencyMs)} ms</td>
                    <td className="px-4 py-4 whitespace-nowrap text-xs">
                      <span className="block">{numberFormat.format(keeper.gasSpentXlm)} XLM gas</span>
                      <span className="mt-1 block text-neutral-400">{numberFormat.format(keeper.revenueXlm)} XLM earned</span>
                    </td>
                    <td className="px-4 py-4">
                      {keeper.slashingIncidents.length === 0 ? (
                        <span className="text-neutral-400">None reported</span>
                      ) : (
                        <ul className="space-y-2">
                          {keeper.slashingIncidents.map((incident) => {
                            const href = explorerUrl(incident.transactionHash);
                            return (
                              <li key={`${incident.transactionHash}-${incident.occurredAt}`} className="max-w-48">
                                <span className="block text-xs text-red-200">{incident.reason}</span>
                                {href ? (
                                  <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs text-blue-300 underline">
                                    Verify transaction
                                  </a>
                                ) : (
                                  <span className="mt-1 block text-xs text-neutral-500">Unverified record</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {certificateActive ? (
                        <span className="text-xs text-emerald-300" title={`Issuer: ${keeper.slaCertificate?.issuer}`}>
                          Verified until {new Date(keeper.slaCertificate!.validUntil).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-500">Not verified</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        disabled={!onDelegate}
                        onClick={() => onDelegate?.(keeper)}
                        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                        title={!walletAddress ? "Connect your Stellar wallet to continue" : "Delegation contract is not configured"}
                      >
                        {walletAddress ? "Delegate" : "Connect wallet"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
