'use client';

/**
 * useShield Hook
 *
 * React binding for the Rate Limiting & Anti-DDoS shield. Owns the worker
 * bridge lifecycle, accumulates the latest snapshot, and exposes a resilient
 * API to the dashboard. All heavy lifting happens inside the engine (on a Web
 * Worker when available), so this hook stays render-cheap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@/src/lib/logger';
import { createShieldBridge, ShieldBridge } from '@/src/lib/shield/bridge';
import {
  DEFAULT_SHIELD_CONFIG,
  RequestEvent,
  ShieldConfig,
  ShieldSnapshot,
  ShieldWorkerHealth,
} from '@/src/lib/shield/types';

const logger = createLogger('useShield');

export interface UseShieldOptions {
  config?: Partial<ShieldConfig>;
  /** When false, the bridge is not created (e.g. feature flag off). */
  enabled?: boolean;
  /** Injected for tests; forwarded to the bridge factory. */
  workerFactory?: () => Worker | null;
  /** Maximum snapshots retained for the history sparkline. */
  historyLimit?: number;
}

export interface UseShieldResult {
  snapshot: ShieldSnapshot | null;
  history: ShieldSnapshot[];
  health: ShieldWorkerHealth;
  /** Submit request telemetry for off-thread analysis. */
  ingest: (events: RequestEvent[]) => void;
  /** Clear all engine state and history. */
  reset: () => void;
  config: ShieldConfig;
}

const INITIAL_HEALTH: ShieldWorkerHealth = {
  offMainThread: false,
  ready: false,
  recoveredErrors: 0,
  lastError: null,
};

export function useShield(options: UseShieldOptions = {}): UseShieldResult {
  const { enabled = true, workerFactory, historyLimit = 60 } = options;

  // Derive a stable key from config *contents* (not identity) so callers can
  // pass an inline `config={{...}}` object without triggering an effect loop.
  const configKey = useMemo(
    () => JSON.stringify({ ...DEFAULT_SHIELD_CONFIG, ...options.config }),
    [options.config],
  );
  const config = useMemo<ShieldConfig>(
    () => JSON.parse(configKey) as ShieldConfig,
    [configKey],
  );

  // The worker factory is only needed when (re)creating the bridge. Keep it in
  // a ref so an unstable inline factory prop never re-runs the effect.
  const workerFactoryRef = useRef(workerFactory);
  workerFactoryRef.current = workerFactory;

  const bridgeRef = useRef<ShieldBridge | null>(null);
  const [snapshot, setSnapshot] = useState<ShieldSnapshot | null>(null);
  const [history, setHistory] = useState<ShieldSnapshot[]>([]);
  const [health, setHealth] = useState<ShieldWorkerHealth>(INITIAL_HEALTH);

  useEffect(() => {
    if (!enabled) return;

    const bridge = createShieldBridge({
      config,
      workerFactory: workerFactoryRef.current,
    });
    bridgeRef.current = bridge;
    setHealth((prev) => ({ ...prev, offMainThread: bridge.offMainThread }));

    const unsubscribe = bridge.subscribe((message) => {
      if (message.type === 'snapshot') {
        setSnapshot(message.snapshot);
        setHistory((prev) => {
          const next = [...prev, message.snapshot];
          return next.length > historyLimit ? next.slice(-historyLimit) : next;
        });
        setHealth((prev) => ({
          ...prev,
          ready: true,
          offMainThread: bridge.offMainThread,
        }));
      } else if (message.type === 'error') {
        logger.warn('Shield engine error; bridge will self-recover', message.message);
        setHealth((prev) => ({
          ...prev,
          recoveredErrors: prev.recoveredErrors + 1,
          offMainThread: bridge.offMainThread,
          lastError: message.message,
        }));
      }
    });

    return () => {
      unsubscribe();
      bridge.dispose();
      bridgeRef.current = null;
    };
    // `config` is reconstructed from `configKey`; depend on the stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, configKey, historyLimit]);

  const ingest = useCallback((events: RequestEvent[]) => {
    if (!events.length) return;
    bridgeRef.current?.ingest(events);
  }, []);

  const reset = useCallback(() => {
    bridgeRef.current?.reset();
    setSnapshot(null);
    setHistory([]);
  }, []);

  return { snapshot, history, health, ingest, reset, config };
}
