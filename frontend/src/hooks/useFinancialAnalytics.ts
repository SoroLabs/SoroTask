"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getHistoryUrl,
  getWebSocketUrl,
  mergeRecords,
  parseHistoryResponse,
  parseSocketMessage,
} from "@/src/lib/financial-analytics/feed";
import type {
  AnalyticsConnectionStatus,
  FinancialRecord,
  FinancialSeriesKind,
} from "@/src/lib/financial-analytics/types";

interface FinancialAnalyticsState {
  records: FinancialRecord[];
  status: AnalyticsConnectionStatus;
  error: string | null;
  lastUpdatedAt: string | null;
}

export function useFinancialAnalytics(kind: FinancialSeriesKind): FinancialAnalyticsState & {
  refresh: () => void;
} {
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [state, setState] = useState<FinancialAnalyticsState>({
    records: [],
    status: "loading",
    error: null,
    lastUpdatedAt: null,
  });

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let tickFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let queuedTicks: FinancialRecord[] = [];
    let reconnectAttempt = 0;
    const controller = new AbortController();

    const setError = (message: string) => {
      if (!active) return;
      setState((current) => ({ ...current, status: "error", error: message }));
    };

    const loadHistory = async () => {
      try {
        const response = await fetch(getHistoryUrl(kind), {
          headers: { Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Analytics history request failed (${response.status}).`);
        }
        const records = parseHistoryResponse(await response.json(), kind);
        if (active) {
          setState((current) => ({
            records: mergeRecords(records, current.records),
            status: current.status === "connected" ? current.status : "disconnected",
            error: null,
            lastUpdatedAt: new Date().toISOString(),
          }));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : "Unable to load analytics history.");
      }
    };

    const connect = () => {
      let url: string | null;
      try {
        url = getWebSocketUrl(kind);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Invalid analytics WebSocket URL.");
        return;
      }
      if (!url || !active) return;

      try {
        socket = new WebSocket(url);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to connect to analytics WebSocket.");
        return;
      }

      socket.onopen = () => {
        if (!active) return;
        reconnectAttempt = 0;
        setState((current) => ({ ...current, status: "connected", error: null }));
      };
      socket.onmessage = (event) => {
        if (!active) return;
        try {
          const message: unknown = JSON.parse(String(event.data));
          const record = parseSocketMessage(message, kind);
          if (!record) return;
          queuedTicks.push(record);
          if (tickFlushTimer === null) {
            tickFlushTimer = setTimeout(() => {
              tickFlushTimer = null;
              const ticks = queuedTicks;
              queuedTicks = [];
              setState((current) => ({
                records: mergeRecords(current.records, ticks),
                status: "connected",
                error: null,
                lastUpdatedAt: new Date().toISOString(),
              }));
            }, 16);
          }
        } catch (error) {
          setError(error instanceof Error ? error.message : "Invalid analytics WebSocket data.");
        }
      };
      socket.onerror = () => {
        setState((current) => ({
          ...current,
          status: current.records.length > 0 ? "disconnected" : "error",
          error: `Analytics WebSocket ${kind} stream encountered a connection error.`,
        }));
      };
      socket.onclose = () => {
        if (!active) return;
        setState((current) => ({
          ...current,
          status: current.records.length > 0 ? "disconnected" : "error",
        }));
        const delay = Math.min(1_000 * 2 ** reconnectAttempt, 30_000);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    void loadHistory();
    connect();

    return () => {
      active = false;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (tickFlushTimer) clearTimeout(tickFlushTimer);
      queuedTicks = [];
      socket?.close();
    };
  }, [kind, refreshCounter]);

  return { ...state, refresh: useCallback(() => setRefreshCounter((value) => value + 1), []) };
}
