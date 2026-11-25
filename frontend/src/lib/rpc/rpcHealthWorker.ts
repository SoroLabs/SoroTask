import type {
  RPCEndpointConfig,
  RPCNodeHealth,
  HealthCheckResult,
} from "./types";

interface WorkerState {
  endpoints: Map<string, RPCEndpointConfig>;
  results: Map<string, RPCNodeHealth>;
  intervalMs: number;
  timeoutMs: number;
  maxHistoricalDataPoints: number;
  degradedLatencyThresholdMs: number;
  criticalLatencyThresholdMs: number;
  failureThreshold: number;
  timerId: ReturnType<typeof setInterval> | null;
}

const state: WorkerState = {
  endpoints: new Map(),
  results: new Map(),
  intervalMs: 15_000,
  timeoutMs: 5_000,
  maxHistoricalDataPoints: 60,
  degradedLatencyThresholdMs: 500,
  criticalLatencyThresholdMs: 2000,
  failureThreshold: 3,
  timerId: null,
};

function computeStatus(health: RPCNodeHealth): RPCNodeHealth["status"] {
  if (health.consecutiveFailures >= state.failureThreshold) return "unhealthy";
  if (
    health.latencyMs !== null &&
    health.latencyMs >= state.criticalLatencyThresholdMs
  )
    return "unhealthy";
  if (
    health.latencyMs !== null &&
    health.latencyMs >= state.degradedLatencyThresholdMs
  )
    return "degraded";
  if (health.consecutiveFailures > 0) return "degraded";
  if (health.latencyMs !== null) return "healthy";
  return "unknown";
}

function computeQuality(latencyMs: number | null): RPCNodeHealth["quality"] {
  if (latencyMs === null) return "unknown";
  if (latencyMs < 100) return "excellent";
  if (latencyMs < 500) return "good";
  if (latencyMs < 2000) return "poor";
  return "offline";
}

function computeUptime(
  historicalLatency: number[],
  consecutiveFailures: number,
): number {
  const total = historicalLatency.length + consecutiveFailures;
  if (total === 0) return 100;
  const successes = historicalLatency.length;
  return Math.round((successes / total) * 100);
}

async function probeEndpoint(
  config: RPCEndpointConfig,
): Promise<HealthCheckResult> {
  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), state.timeoutMs);

  try {
    const response = await fetch(config.url, {
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
    const success = response.ok;

    return {
      endpointId: config.id,
      url: config.url,
      success,
      latencyMs,
      error: success ? null : `HTTP ${response.status}`,
      timestamp: Date.now(),
    };
  } catch (err) {
    const latencyMs = performance.now() - start;
    return {
      endpointId: config.id,
      url: config.url,
      success: false,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function mergeResult(
  existing: RPCNodeHealth | undefined,
  result: HealthCheckResult,
): RPCNodeHealth {
  const historicalLatency = existing?.historicalLatency ?? [];
  const updatedLatency = result.success
    ? [
        ...historicalLatency.slice(-(state.maxHistoricalDataPoints - 1)),
        result.latencyMs,
      ]
    : historicalLatency;

  const consecutiveFailures = result.success
    ? 0
    : (existing?.consecutiveFailures ?? 0) + 1;
  const consecutiveSuccesses = result.success
    ? (existing?.consecutiveSuccesses ?? 0) + 1
    : 0;

  const base: RPCNodeHealth = {
    endpointId: result.endpointId,
    url: result.url,
    name: existing?.name ?? "",
    network: existing?.network ?? "mainnet",
    status: "unknown",
    quality: "unknown",
    latencyMs: result.success ? result.latencyMs : null,
    lastCheckedAt: result.timestamp,
    consecutiveFailures,
    consecutiveSuccesses,
    lastError: result.error,
    historicalLatency: updatedLatency,
    uptimePercent: 100,
  };

  base.quality = computeQuality(result.success ? result.latencyMs : null);
  base.uptimePercent = computeUptime(updatedLatency, consecutiveFailures);
  base.status = computeStatus(base);

  return base;
}

async function runProbes(): Promise<RPCNodeHealth[]> {
  const configs = Array.from(state.endpoints.values());
  const results = await Promise.allSettled(configs.map(probeEndpoint));

  const healthResults: RPCNodeHealth[] = [];

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const settled = results[i];

    if (settled.status === "fulfilled") {
      const result = settled.value;
      const existing = state.results.get(config.id);
      const merged = mergeResult(existing, result);
      state.results.set(config.id, merged);
      healthResults.push(merged);
    } else {
      const existing = state.results.get(config.id);
      const errorResult: HealthCheckResult = {
        endpointId: config.id,
        url: config.url,
        success: false,
        latencyMs: 0,
        error:
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason),
        timestamp: Date.now(),
      };
      const merged = mergeResult(existing, errorResult);
      state.results.set(config.id, merged);
      healthResults.push(merged);
    }
  }

  return healthResults;
}

function postHealthUpdate(): void {
  const nodes = Array.from(state.results.values());
  self.postMessage({ type: "HEALTH_UPDATE", payload: nodes });
}

function startProbes(): void {
  if (state.timerId !== null) return;
  state.timerId = setInterval(() => {
    runProbes()
      .then(postHealthUpdate)
      .catch(() => postHealthUpdate());
  }, state.intervalMs);
  runProbes()
    .then(postHealthUpdate)
    .catch(() => postHealthUpdate());
}

function stopProbes(): void {
  if (state.timerId !== null) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function handleMessage(event: MessageEvent): void {
  const { type, payload } = event.data ?? {};

  switch (type) {
    case "INIT": {
      const config = payload as {
        endpoints: RPCEndpointConfig[];
        intervalMs?: number;
        timeoutMs?: number;
        maxHistoricalDataPoints?: number;
        degradedLatencyThresholdMs?: number;
        criticalLatencyThresholdMs?: number;
        failureThreshold?: number;
      };

      state.intervalMs = config.intervalMs ?? state.intervalMs;
      state.timeoutMs = config.timeoutMs ?? state.timeoutMs;
      state.maxHistoricalDataPoints =
        config.maxHistoricalDataPoints ?? state.maxHistoricalDataPoints;
      state.degradedLatencyThresholdMs =
        config.degradedLatencyThresholdMs ?? state.degradedLatencyThresholdMs;
      state.criticalLatencyThresholdMs =
        config.criticalLatencyThresholdMs ?? state.criticalLatencyThresholdMs;
      state.failureThreshold =
        config.failureThreshold ?? state.failureThreshold;

      for (const ep of config.endpoints) {
        state.endpoints.set(ep.id, ep);
        state.results.set(ep.id, {
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

      startProbes();
      self.postMessage({ type: "WORKER_READY", payload: null });
      break;
    }

    case "ADD_ENDPOINT": {
      const ep = payload as RPCEndpointConfig;
      if (!state.endpoints.has(ep.id)) {
        state.endpoints.set(ep.id, ep);
        state.results.set(ep.id, {
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
      break;
    }

    case "REMOVE_ENDPOINT": {
      const id = payload as string;
      state.endpoints.delete(id);
      state.results.delete(id);
      break;
    }

    case "UPDATE_CONFIG": {
      const cfg = payload as Partial<typeof state>;
      if (cfg.intervalMs !== undefined) {
        state.intervalMs = cfg.intervalMs;
        stopProbes();
        startProbes();
      }
      if (cfg.timeoutMs !== undefined) state.timeoutMs = cfg.timeoutMs;
      if (cfg.maxHistoricalDataPoints !== undefined)
        state.maxHistoricalDataPoints = cfg.maxHistoricalDataPoints;
      if (cfg.degradedLatencyThresholdMs !== undefined)
        state.degradedLatencyThresholdMs = cfg.degradedLatencyThresholdMs;
      if (cfg.criticalLatencyThresholdMs !== undefined)
        state.criticalLatencyThresholdMs = cfg.criticalLatencyThresholdMs;
      if (cfg.failureThreshold !== undefined)
        state.failureThreshold = cfg.failureThreshold;
      break;
    }

    case "RESET": {
      stopProbes();
      state.endpoints.clear();
      state.results.clear();
      break;
    }

    default:
      break;
  }
}

if (typeof self !== "undefined" && typeof window === "undefined") {
  self.onmessage = handleMessage;
}
