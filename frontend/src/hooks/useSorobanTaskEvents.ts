"use client";

import { useEffect, useRef } from "react";
import {
  getTaskEventSubscription,
} from "@/src/lib/soroban/taskEventSubscription";
import type { TaskChainEvent } from "@/src/types/sorobanEvents";

export interface UseSorobanTaskEventsOptions {
  /** Soroban RPC URL; defaults to the subscription module's own default. */
  rpcUrl?: string;
  /** Poll interval override, in ms. */
  pollIntervalMs?: number;
  enabled?: boolean;
}

/**
 * Subscribes to on-chain events for a single task, via a shared
 * per-contract Soroban RPC poll (see `getTaskEventSubscription`).
 *
 * Keeps the latest `onEvent` callback in a ref so the subscription itself
 * doesn't need to be torn down and rebuilt every time a caller passes a new
 * inline callback.
 */
export function useSorobanTaskEvents(
  taskId: string | undefined,
  contractId: string | undefined,
  onEvent: (event: TaskChainEvent) => void,
  options: UseSorobanTaskEventsOptions = {},
): void {
  const { rpcUrl, pollIntervalMs, enabled = true } = options;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !taskId || !contractId) return;

    const subscription = getTaskEventSubscription({
      contractId,
      rpcUrl,
      pollIntervalMs,
    });

    const handleEvent = (event: TaskChainEvent) => {
      if (event.taskId !== taskId) return;
      onEventRef.current(event);
    };

    subscription.on("event", handleEvent);
    subscription.acquire();

    return () => {
      subscription.off("event", handleEvent);
      subscription.release();
    };
  }, [taskId, contractId, enabled, rpcUrl, pollIntervalMs]);
}
