"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/app/context/WalletContext";
import { parsePortfolioSnapshot, type PortfolioSnapshot } from "@/src/lib/portfolio-allocation";
import type { PortfolioAllocationChartProps } from "./PortfolioAllocationChart";

const Chart = dynamic(() => import("./PortfolioAllocationChart"), {
  ssr: false,
  loading: () => <p role="status" className="my-8 p-6 text-slate-300">Loading portfolio chart…</p>,
});
type View = { key: string; status: NonNullable<PortfolioAllocationChartProps["status"]>; snapshot?: PortfolioSnapshot };

export function DashboardPortfolioAllocation() {
  const { session } = useWallet();
  const address = session?.address;
  const networkPassphrase = session?.network.networkPassphrase;
  const [view, setView] = useState<View>({ key: "", status: "disconnected" });
  const [attempt, setAttempt] = useState(0);
  const key = address && networkPassphrase ? `${address}:${networkPassphrase}:${attempt}` : "";
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!address || !networkPassphrase) return;
    const controller = new AbortController();
    let cancelled = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      controller.abort();
      if (!cancelled) setView({ key, status: "error" });
    }, 10_000);
    void (async () => {
      try {
        const query = new URLSearchParams({ address, networkPassphrase });
        const response = await fetch(`/api/portfolio-allocation?${query}`, { cache: "no-store", signal: controller.signal });
        const raw: unknown = await response.json();
        if (cancelled || controller.signal.aborted) return;
        if (!response.ok) {
          const code = raw && typeof raw === "object" && "error" in raw ? raw.error : "";
          setView({ key, status: code === "not_configured" ? "not-configured" : "error" });
          return;
        }
        const snapshot = parsePortfolioSnapshot(raw, { address, networkPassphrase });
        const age = Date.now() - Date.parse(snapshot.asOf);
        if (age > 5 * 60_000 || age < -60_000) throw new Error("Stale portfolio snapshot");
        setView({ key, status: "ready", snapshot });
        expiry = setTimeout(() => {
          if (!cancelled) setView({ key, status: "error" });
        }, Math.max(1, 5 * 60_000 - age));
      } catch {
        if (!cancelled) setView({ key, status: "error" });
      } finally { clearTimeout(timeout); }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
      clearTimeout(expiry);
    };
  }, [address, networkPassphrase, key, attempt]);

  // Never render a previous wallet's values, even before its effect cleanup runs.
  const current = !key ? { status: "disconnected" as const } : view.key === key ? view : { status: "loading" as const };
  return <Chart status={current.status} snapshot={"snapshot" in current ? current.snapshot : undefined} onRetry={retry} />;
}
