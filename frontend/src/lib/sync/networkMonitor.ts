/**
 * Network Monitor
 *
 * Monitors browser connectivity and RPC health to determine whether
 * the sync manager should be flushing or pausing. Uses lightweight
 * health checks (fetch with low timeout) rather than full RPC calls.
 */

import { createLogger } from "../logger";

const logger = createLogger("network-monitor");

export type ConnectionQuality = "excellent" | "good" | "poor" | "offline" | "unknown";

export interface NetworkHealth {
  online: boolean;
  quality: ConnectionQuality;
  lastPingMs: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastChangeAt: number | null;
  lastError: string | null;
}

export interface NetworkMonitorConfig {
  rpcEndpoint: string;
  healthCheckIntervalMs: number;
  timeoutMs: number;
  requiredConsecutiveSuccesses: number;
  degradedAfterFailures: number;
}

const DEFAULT_CONFIG: Omit<Required<NetworkMonitorConfig>, "rpcEndpoint"> = {
  healthCheckIntervalMs: 30_000,
  timeoutMs: 5_000,
  requiredConsecutiveSuccesses: 2,
  degradedAfterFailures: 3,
};

export class NetworkMonitor {
  private config: Required<Omit<NetworkMonitorConfig, "rpcEndpoint">> & Pick<NetworkMonitorConfig, "rpcEndpoint">;
  private health: NetworkHealth;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(health: NetworkHealth) => void>();
  private destroyed = false;

  constructor(config: NetworkMonitorConfig) {
    this.config = {
      healthCheckIntervalMs: config.healthCheckIntervalMs,
      timeoutMs: config.timeoutMs,
      requiredConsecutiveSuccesses: config.requiredConsecutiveSuccesses,
      degradedAfterFailures: config.degradedAfterFailures,
      rpcEndpoint: config.rpcEndpoint,
    };

    this.health = {
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      quality: "unknown",
      lastPingMs: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastChangeAt: null,
      lastError: null,
    };
  }

  /**
   * Start monitoring.
   */
  start(): void {
    if (this.destroyed) return;
    if (this.timer) return;

    this.probe();
    this.timer = setTimeout(() => {
      this.tick();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Destroy and clean up all listeners and timers.
   */
  destroy(): void {
    this.destroyed = true;
    this.stop();
    this.listeners.clear();
  }

  /**
   * Get current health state.
   */
  getHealth(): NetworkHealth {
    return { ...this.health };
  }

  /**
   * Subscribe to health changes.
   */
  subscribe(listener: (health: NetworkHealth) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Manually trigger an immediate probe.
   */
  async probe(): Promise<NetworkHealth> {
    if (this.destroyed) return this.getHealth();

    const start = performance.now();
    try {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), this.config.timeoutMs);
      try {
        await fetch(this.config.rpcEndpoint, {
          method: "HEAD",
          mode: "no-cors",
          signal: ctrl.signal,
          // Add a cache-busting query to avoid network caching
          cache: "no-store",
        });
      } finally {
        clearTimeout(timeoutId);
      }
      this.recordSuccess(performance.now() - start);
    } catch (err) {
      this.recordFailure(err);
    }
    return this.getHealth();
  }

  /**
   * Re-attach browser event listeners if needed.
   */
  attachBrowserListeners(): void {
    if (this.destroyed) return;
    window.addEventListener("online", this.handleBrowserOnline);
    window.addEventListener("offline", this.handleBrowserOffline);
  }

  /**
   * Remove browser event listeners.
   */
  detachBrowserListeners(): void {
    window.removeEventListener("online", this.handleBrowserOnline);
    window.removeEventListener("offline", this.handleBrowserOffline);
  }

  private tick(): void {
    if (this.destroyed) return;
    void this.probe();
    this.timer = setTimeout(() => this.tick(), this.config.healthCheckIntervalMs);
  }

  private handleBrowserOnline = (): void => {
    if (this.destroyed) return;
    this.recordSuccess(0);
    logger.info("Browser reports online");
  };

  private handleBrowserOffline = (): void => {
    if (this.destroyed) return;
    this.recordFailure(new Error("Browser reports offline"));
    logger.warn("Browser reports offline");
  };

  private recordSuccess(latencyMs: number): void {
    const prevOnline = this.health.online;
    this.health = {
      online: true,
      consecutiveSuccesses: this.health.consecutiveSuccesses + 1,
      consecutiveFailures: 0,
      lastPingMs: latencyMs,
      lastError: null,
      lastChangeAt: prevOnline ? this.health.lastChangeAt : Date.now(),
      quality: this.computeQuality(latencyMs),
    };

    if (!prevOnline) {
      logger.info("Connectivity restored", { latencyMs, quality: this.health.quality });
    }

    this.notify();
  }

  private recordFailure(err: unknown): void {
    const prevOnline = this.health.online;
    this.health = {
      online: false,
      consecutiveFailures: this.health.consecutiveFailures + 1,
      consecutiveSuccesses: 0,
      lastPingMs: null,
      lastError: err instanceof Error ? err.message : String(err),
      lastChangeAt: prevOnline ? Date.now() : this.health.lastChangeAt,
      quality: "offline",
    };

    if (prevOnline) {
      logger.warn("Connectivity lost", { error: this.health.lastError });
    }

    this.notify();
  }

  private computeQuality(latencyMs: number): ConnectionQuality {
    if (latencyMs < 100) return "excellent";
    if (latencyMs < 500) return "good";
    if (latencyMs < 2000) return "poor";
    return "offline";
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getHealth());
      } catch (err) {
        logger.error("Listener threw", { error: err });
      }
    }
  }
}

export function createNetworkMonitor(config: NetworkMonitorConfig): NetworkMonitor {
  return new NetworkMonitor(config);
}
