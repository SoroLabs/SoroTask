"use client";

import { useKeeperStats } from "@/app/hooks/useKeeperStats";
import { truncateAddress } from "@/app/lib/wallet";

export default function KeepersPage() {
  const { keepers, loading, error, refresh } = useKeeperStats({ limit: 50 });

  return (
    <main
      data-onboarding="keepers-leaderboard"
      className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-100">
            Keeper Leaderboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Top Keepers ranked by tasks executed and bounties earned,
            network-wide.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}. Ensure the indexer is running at{" "}
          {process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000"}.
        </div>
      ) : null}

      {loading && keepers.length === 0 ? (
        <p className="text-sm text-slate-400">Loading keeper leaderboard…</p>
      ) : null}

      {!loading && !error && keepers.length === 0 ? (
        <p className="text-sm text-slate-400">
          No Keepers have executed a task yet.
        </p>
      ) : null}

      {keepers.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Keeper</th>
                <th className="px-4 py-3 text-right">Tasks executed</th>
                <th className="px-4 py-3 text-right">Bounties earned (XLM)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {keepers.map((keeper, index) => (
                <tr key={keeper.address} className="text-slate-200">
                  <td className="px-4 py-3 text-slate-400">#{index + 1}</td>
                  <td className="px-4 py-3 font-mono" title={keeper.address}>
                    {truncateAddress(keeper.address)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {keeper.tasksExecuted}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {keeper.bountiesEarnedXlm.toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
