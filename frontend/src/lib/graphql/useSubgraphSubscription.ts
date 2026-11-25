"use client";

import { useEffect, useRef, useState } from "react";
import { GraphQLSubscriptionManager } from "./SubscriptionManager";
import type {
  SubgraphConfig,
  SubscriptionRequest,
  SubscriptionStatus,
} from "./types";

interface UseSubgraphSubscriptionOptions<TData> {
  config: SubgraphConfig;
  request: SubscriptionRequest;
  onData: (data: TData) => void;
  onError?: (error: Error) => void;
  /** Skip subscribing when false (e.g. waiting for auth) */
  enabled?: boolean;
}

interface UseSubgraphSubscriptionResult {
  status: SubscriptionStatus;
}

/**
 * Subscribes to a GraphQL subgraph over WebSocket.
 *
 * A single `GraphQLSubscriptionManager` is created per unique `config.wsUrl`
 * and reused across re-renders. The subscription is torn down when the
 * component unmounts or `enabled` flips to false.
 */
export function useSubgraphSubscription<TData = unknown>({
  config,
  request,
  onData,
  onError,
  enabled = true,
}: UseSubgraphSubscriptionOptions<TData>): UseSubgraphSubscriptionResult {
  const managerRef = useRef<GraphQLSubscriptionManager | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus>("idle");

  // Stable callback refs so we don't need them as effect deps
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) return;

    if (!managerRef.current) {
      managerRef.current = new GraphQLSubscriptionManager(config);
    }
    const manager = managerRef.current;

    const unsubscribeStatus = manager.onStatusChange(setStatus);
    setStatus(manager.getStatus());

    const handle = manager.subscribe<TData>(
      request,
      (data) => onDataRef.current(data),
      (err) => onErrorRef.current?.(err)
    );

    return () => {
      unsubscribeStatus();
      handle.unsubscribe();
    };
    // config.wsUrl is the stable identity key for the manager
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, config.wsUrl, request.query, request.operationName]);

  return { status };
}
