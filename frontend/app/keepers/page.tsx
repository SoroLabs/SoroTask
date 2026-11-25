"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/app/context/WalletContext";
import { WalletButton } from "@/app/components/WalletButton";
import { KeeperTable, type KeeperRecord } from "@/src/components/KeeperTable";

const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? "http://localhost:3000";
const REFRESH_INTERVAL_MS = 15_000;

function isKeeperRecord(value: unknown): value is KeeperRecord {
  if (!value || typeof value !== "object") return false;
  const keeper = value as Record<string, unknown>;
  const validMetrics = (
    typeof keeper.id === "string" &&
    typeof keeper.address === "string" &&
    ["bronze", "silver", "gold", "platinum"].includes(String(keeper.tier)) &&
    ["stakeXlm", "totalExecutions", "successfulExecutions", "uptimePercent", "averageLatencyMs", "gasSpentXlm", "revenueXlm"]
      .every((key) => typeof keeper[key] === "number" && Number.isFinite(keeper[key]))
  );
  if (!validMetrics || !Array.isArray(keeper.slashingIncidents)) return false;

  const validIncidents = keeper.slashingIncidents.every((incident: unknown) => {
    if (!incident || typeof incident !== "object") return false;
    const record = incident as Record<string, unknown>;
    return (
      typeof record.occurredAt === "string" &&
      typeof record.reason === "string" &&
      typeof record.transactionHash === "string"
    );
  });
  if (!validIncidents) return false;
  if (keeper.slaCertificate === undefined) return true;
  if (!keeper.slaCertificate || typeof keeper.slaCertificate !== "object") return false;
  const certificate = keeper.slaCertificate as Record<string, unknown>;
  return (
    typeof certificate.issuer === "string" &&
    typeof certificate.validUntil === "string" &&
    typeof certificate.transactionHash === "string"
  );
}

function KeeperLeaderboard() {
  const { session, connect, status, errorMessage } = useWallet();
  const [keepers, setKeepers] = useState<KeeperRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedKeeper, setSelectedKeeper] = useState<KeeperRecord | null>(null);

  const refreshKeepers = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${KEEPER_URL.replace(/\/$/, "")}/api/keepers/leaderboard`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(`Keeper service returned HTTP ${response.status}.`);
      const data: unknown = await response.json();
      const records = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as { keepers?: unknown }).keepers)
          ? (data as { keepers: unknown[] }).keepers
          : null;
      if (!records || !records.every(isKeeperRecord)) {
        throw new Error("Keeper service returned an invalid leaderboard response.");
      }
      setKeepers(records);
      setLastUpdated(new Date());
      setError(null);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Failed to load keeper metrics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshKeepers(controller.signal);
    const interval = window.setInterval(() => void refreshKeepers(), REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshKeepers]);

  const handleDelegate = (keeper: KeeperRecord) => {
    if (!session) {
      void connect();
      return;
    }
    setSelectedKeeper(keeper);
  };

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-7">
        <header className="flex flex-col gap-5 border-b border-neutral-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Network / Operators</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Keeper leaderboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">
              Compare reported execution reliability, staking tiers, latency, operating costs, and slashing history.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-neutral-500">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Connecting to keeper service"}
            </p>
            <button
              type="button"
              onClick={() => void refreshKeepers()}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800"
            >
              Refresh
            </button>
            <WalletButton />
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            Could not load live keeper records: {error}
            {keepers.length > 0 && " Showing the last successful response."}
          </div>
        )}

        {errorMessage && status === "error" && (
          <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {errorMessage}
          </p>
        )}

        <KeeperTable
          keepers={keepers}
          loading={loading}
          walletAddress={session?.address}
          onDelegate={handleDelegate}
        />

        <p className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 text-xs leading-relaxed text-neutral-400">
          Metrics, SLA certificates, and slashing records are sourced from the keeper service and are not independently
          verified by this page. Wallet connection is available, but this repository does not expose a staking/delegation
          contract method; no delegation transaction will be submitted.
        </p>
      </div>

      {selectedKeeper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="delegation-title" className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6">
            <h2 id="delegation-title" className="text-xl font-semibold">Delegation unavailable</h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300">
              Your wallet <span className="font-mono">{session?.address}</span> is connected. The staking contract
              integration is not available, so no XLM will be transferred to {selectedKeeper.id}.
            </p>
            <button
              type="button"
              onClick={() => setSelectedKeeper(null)}
              className="mt-6 rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium hover:bg-neutral-600"
            >
              Close
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

export default function KeepersPage() {
  return <KeeperLeaderboard />;
}
