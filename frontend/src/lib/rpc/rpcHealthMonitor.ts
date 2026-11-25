import type {
  RPCEndpointConfig,
  RPCNodeHealth,
  RPCHealthMonitorConfig,
  RPCHealthState,
  OverallStatus,
  WorkerMode,
} from "./types";
import { DEFAULT_RPC_MONITOR_CONFIG } from "./constants";
import { createLogger } from "../logger";

const logger = createLogger("rpc-health-monitor");

type HealthListener = (state: RPCHealthState) => void;

function computeOverallStatus(
  nodes: Map<string, RPCNodeHealth>,
): OverallStatus {
  let unhealthy = 0;
  let degraded = 0;
  let healthy = 0;

  for (const node of nodes.values()) {
    if (node.status === "unhealthy") unhealthy++;
    else if (node.status === "degraded") degraded++;
    else if (node.status === "healthy") healthy++;
  }

  if (nodes.size === 0) return "critical";
  if (unhealthy === nodes.size) return "critical";
  if (unhealthy > 0) return "degraded";
  if (degraded > 0) return "degraded";
  if (healthy > 0) return "healthy";
  return "degraded";
}

export class RPCHealthMonitor {
  private config: Required<RPCHealthMonitorConfig>;
  private worker: Worker | null = null;
  private mode: WorkerMode = "worker";
  private nodes: Map<string, RPCNodeHealth> = new Map();
  private listeners = new Set<HealthListener>();
  private destroyed = false;
  private inlineTimer: ReturnType<typeof setInterval> | null = null;
  private workerReady = false;

  constructor(config?: Partial<RPCHealthMonitorConfig>) {
    this.config = {
      endpoints: config?.endpoints ?? DEFAULT_RPC_MONITOR_CONFIG.endpoints,
      globalIntervalMs:
        config?.globalIntervalMs ?? DEFAULT_RPC_MONITOR_CONFIG.globalIntervalMs,
      globalTimeoutMs:
        config?.globalTimeoutMs ?? DEFAULT_RPC_MONITOR_CONFIG.globalTimeoutMs,
      maxHistoricalDataPoints:
        config?.maxHistoricalDataPoints ??
        DEFAULT_RPC_MONITOR_CONFIG.maxHistoricalDataPoints,
      degradedLatencyThresholdMs:
        config?.degradedLatencyThresholdMs ??
        DEFAULT_RPC_MONITOR_CONFIG.degradedLatencyThresholdMs,
      criticalLatencyThresholdMs:
        config?.criticalLatencyThresholdMs ??
        DEFAULT_RPC_MONITOR_CONFIG.criticalLatencyThresholdMs,
      failureThreshold:
        config?.failureThreshold ?? DEFAULT_RPC_MONITOR_CONFIG.failureThreshold,
    };

    for (const ep of this.config.endpoints) {
      this.nodes.set(ep.id, {
        endpointId: ep.id,
        url: ep.url,
        name: ep.name,
        network: ep.network ?? "mainnet",
        status: "unknown",
        quality: "unknown",
        latencyMs: null,
        lastCheckedAt: null,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastError: null,
        historicalLatency: [],
        uptimePercent: 100,
      });
    }
  }

  start(): void {
    if (this.destroyed) return;
    this.tryInitWorker();
  }

  stop(): void {
    if (this.worker && this.mode === "worker") {
      try {
        this.worker.terminate();
      } catch {
        // Worker terminate is safe
      }
      this.worker = null;
    }
    if (this.inlineTimer !== null) {
      clearInterval(this.inlineTimer);
      this.inlineTimer = null;
    }
    this.workerReady = false;
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
    this.listeners.clear();
  }

  getState(): RPCHealthState {
    return {
      nodes: new Map(this.nodes),
      overallStatus: computeOverallStatus(this.nodes),
      lastUpdatedAt: this.getLastUpdatedAt(),
      isWorkerActive: this.mode === "worker" && this.workerReady,
      isLoading: false,
      error: null,
    };
  }

  subscribe(listener: HealthListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  addEndpoint(config: RPCEndpointConfig): void {
    if (this.nodes.has(config.id)) return;

    const newNode: RPCNodeHealth = {
      endpointId: config.id,
      url: config.url,
      name: config.name,
      network: config.network ?? "mainnet",
      status: "unknown",
      quality: "unknown",
      latencyMs: null,
      lastCheckedAt: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastError: null,
      historicalLatency: [],
      uptimePercent: 100,
    };

    this.nodes.set(config.id, newNode);
    this.config.endpoints.push(config);

    if (this.worker && this.workerReady) {
      this.worker.postMessage({ type: "ADD_ENDPOINT", payload: config });
    }

    this.notify();
  }

  removeEndpoint(id: string): void {
    this.nodes.delete(id);
    this.config.endpoints = this.config.endpoints.filter((ep) => ep.id !== id);

    if (this.worker && this.workerReady) {
      this.worker.postMessage({ type: "REMOVE_ENDPOINT", payload: id });
    }

    this.notify();
  }

  refreshNow(): void {
    if (this.worker && this.workerReady) {
      this.worker.postMessage({ type: "PROBE_ALL", payload: null });
    } else {
      void this.runInlineProbes();
    }
  }

  getWorkerMode(): WorkerMode {
    return this.mode;
  }

  private tryInitWorker(): void {
    try {
      const worker = new Worker(
        new URL("./rpcHealthWorker.ts", import.meta.url),
        { type: "module" },
      );

      worker.onmessage = (event: MessageEvent) => {
        const { type, payload } = event.data ?? {};

        switch (type) {
          case "WORKER_READY": {
            this.workerReady = true;
            logger.info("RPC health worker initialized");
            this.notify();
            break;
          }
          case "HEALTH_UPDATE": {
            const healthNodes = payload as RPCNodeHealth[];
            for (const node of healthNodes) {
              this.nodes.set(node.endpointId, node);
            }
            this.notify();
            break;
          }
          case "WORKER_ERROR": {
            logger.error("RPC health worker error", { error: payload });
            break;
          }
          default:
            break;
        }
      };

      worker.onerror = () => {
        logger.warn("RPC health worker error event, falling back to inline");
        this.fallbackToInline();
      };

      worker.postMessage({
        type: "INIT",
        payload: {
          endpoints: this.config.endpoints,
          intervalMs: this.config.globalIntervalMs,
          timeoutMs: this.config.globalTimeoutMs,
          maxHistoricalDataPoints: this.config.maxHistoricalDataPoints,
          degradedLatencyThresholdMs: this.config.degradedLatencyThresholdMs,
          criticalLatencyThresholdMs: this.config.criticalLatencyThresholdMs,
          failureThreshold: this.config.failureThreshold,
        },
      });

      this.worker = worker;
      this.mode = "worker";
    } catch (err) {
      logger.warn(
        "Failed to create RPC health worker, falling back to inline",
        { error: err },
      );
      this.fallbackToInline();
    }
  }

  private fallbackToInline(): void {
    this.mode = "inline-fallback";
    this.workerReady = false;

    if (this.inlineTimer !== null) {
      clearInterval(this.inlineTimer);
    }

    void this.runInlineProbes();
    this.inlineTimer = setInterval(() => {
      void this.runInlineProbes();
    }, this.config.globalIntervalMs);
  }

  private async runInlineProbes(): Promise<void> {
    if (this.destroyed) return;

    const results = await Promise.allSettled(
      this.config.endpoints.map(async (ep) => {
        const start = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.globalTimeoutMs,
        );

        try {
          const response = await fetch(ep.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getHealth",
              params: [],
            }),
            signal: controller.signal,
            cache: "no-store",
          });

          const latencyMs = performance.now() - start;
          return {
            endpointId: ep.id,
            url: ep.url,
            success: response.ok,
            latencyMs,
            error: response.ok ? null : `HTTP ${response.status}`,
            timestamp: Date.now(),
          };
        } catch (err) {
          const latencyMs = performance.now() - start;
          return {
            endpointId: ep.id,
            url: ep.url,
            success: false,
            latencyMs,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          };
        } finally {
          clearTimeout(timeoutId);
        }
      }),
    );

    for (const settled of results) {
      if (settled.status === "fulfilled") {
        const result = settled.value;
        const existing = this.nodes.get(result.endpointId);
        if (existing) {
          const historicalLatency = result.success
            ? [
                ...existing.historicalLatency.slice(
                  -(this.config.maxHistoricalDataPoints - 1),
                ),
                result.latencyMs,
              ]
            : existing.historicalLatency;

          const consecutiveFailures = result.success
            ? 0
            : existing.consecutiveFailures + 1;
          const consecutiveSuccesses = result.success
            ? existing.consecutiveSuccesses + 1
            : 0;
          const total = historicalLatency.length + consecutiveFailures;
          const uptimePercent =
            total === 0
              ? 100
              : Math.round((historicalLatency.length / total) * 100);

          this.nodes.set(result.endpointId, {
            ...existing,
            latencyMs: result.success ? result.latencyMs : null,
            lastCheckedAt: result.timestamp,
            consecutiveFailures,
            consecutiveSuccesses,
            lastError: result.error,
            historicalLatency,
            uptimePercent,
            status: computeNodeStatus(
              consecutiveFailures,
              result.latencyMs,
              result.success,
              this.config.failureThreshold,
              this.config.degradedLatencyThresholdMs,
              this.config.criticalLatencyThresholdMs,
            ),
            quality: computeNodeQuality(
              result.success ? result.latencyMs : null,
            ),
          });
        }
      }
    }

    this.notify();
  }

  private getLastUpdatedAt(): number | null {
    let latest: number | null = null;
    for (const node of this.nodes.values()) {
      if (
        node.lastCheckedAt !== null &&
        (latest === null || node.lastCheckedAt > latest)
      ) {
        latest = node.lastCheckedAt;
      }
    }
    return latest;
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        logger.error("Listener threw", { error: err });
      }
    }
  }
}

function computeNodeStatus(
  consecutiveFailures: number,
  latencyMs: number | null,
  success: boolean,
  failureThreshold: number,
  degradedThreshold: number,
  criticalThreshold: number,
): RPCNodeHealth["status"] {
  if (consecutiveFailures >= failureThreshold) return "unhealthy";
  if (!success && consecutiveFailures > 0) return "degraded";
  if (latencyMs !== null && latencyMs >= criticalThreshold) return "unhealthy";
  if (latencyMs !== null && latencyMs >= degradedThreshold) return "degraded";
  if (success) return "healthy";
  return "unknown";
}

function computeNodeQuality(
  latencyMs: number | null,
): RPCNodeHealth["quality"] {
  if (latencyMs === null) return "unknown";
  if (latencyMs < 100) return "excellent";
  if (latencyMs < 500) return "good";
  if (latencyMs < 2000) return "poor";
  return "offline";
}

export function computeOverallStatusFromNodes(
  nodes: Map<string, RPCNodeHealth>,
): OverallStatus {
  return computeOverallStatus(nodes);
}
