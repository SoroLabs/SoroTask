"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000";

export type KeeperStat = {
  address: string;
  tasksExecuted: number;
  bountiesEarnedXlm: number;
};

export type KeeperStatsState = {
  keepers: KeeperStat[];
  loading: boolean;
  error: string | null;
};

const QUERY = `
  query KeeperStats($limit: Int) {
    keeperStats(limit: $limit) {
      address
      tasksExecuted
      bountiesEarnedXlm
    }
  }
`;

export function useKeeperStats(options: { limit?: number } = {}) {
  const limit = options.limit ?? 50;
  const [state, setState] = useState<KeeperStatsState>({
    keepers: [],
    loading: true,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const fetchStats = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const res = await fetch(`${INDEXER_URL}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { limit } }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Keeper stats request failed (${res.status})`);
      }

      const body = (await res.json()) as {
        data?: { keeperStats: KeeperStat[] };
        errors?: { message: string }[];
      };

      if (body.errors?.length) {
        throw new Error(body.errors[0].message);
      }

      setState({
        keepers: body.data?.keeperStats ?? [],
        loading: false,
        error: null,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load keeper stats",
      }));
    }
  }, [limit]);

  useEffect(() => {
    fetchStats();
    return () => abortRef.current?.abort();
  }, [fetchStats]);

  return { ...state, refresh: fetchStats };
}
