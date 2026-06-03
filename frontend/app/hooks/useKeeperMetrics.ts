"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeeperMetrics } from "./useSocket";

const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? "http://localhost:3000";
const POLL_MS = 5000;

export type MetricsHistoryPoint = {
  timestamp: string;
  tasksCheckedTotal: number;
  tasksDueTotal: number;
  tasksExecutedTotal: number;
  tasksFailedTotal: number;
  successRate: number;
  avgFeePaidXlm: number;
  lastCycleDurationMs: number;
};

export type KeeperMetricsState = {
  snapshot: KeeperMetrics | null;
  history: MetricsHistoryPoint[];
  loading: boolean;
  error: string | null;
};

export function useKeeperMetrics(options: { enabled?: boolean; range?: number } = {}) {
  const enabled = options.enabled ?? true;
  const range = options.range ?? 60;
  const [state, setState] = useState<KeeperMetricsState>({
    snapshot: null,
    history: [],
    loading: true,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const fetchMetrics = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const [metricsRes, historyRes] = await Promise.all([
        fetch(`${KEEPER_URL}/metrics`, { signal: controller.signal }),
        fetch(`${KEEPER_URL}/metrics/history?limit=${range}`, {
          signal: controller.signal,
        }),
      ]);

      if (!metricsRes.ok) {
        throw new Error(`Metrics request failed (${metricsRes.status})`);
      }

      const snapshot = (await metricsRes.json()) as KeeperMetrics;
      let history: MetricsHistoryPoint[] = [];

      if (historyRes.ok) {
        const body = (await historyRes.json()) as { samples: MetricsHistoryPoint[] };
        history = body.samples ?? [];
      }

      setState({
        snapshot,
        history,
        loading: false,
        error: null,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load keeper metrics",
      }));
    }
  }, [range]);

  useEffect(() => {
    if (!enabled) return;
    fetchMetrics();
    const id = window.setInterval(fetchMetrics, POLL_MS);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [enabled, fetchMetrics]);

  return { ...state, refresh: fetchMetrics };
}
