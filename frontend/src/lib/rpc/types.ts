export type RPCNodeStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export type ConnectionQuality =
  | "excellent"
  | "good"
  | "poor"
  | "offline"
  | "unknown";

export type OverallStatus = "healthy" | "degraded" | "critical";

export interface RPCEndpointConfig {
  id: string;
  url: string;
  name: string;
  network?: "mainnet" | "testnet" | "futurenet";
  healthCheckIntervalMs?: number;
  timeoutMs?: number;
}

export interface RPCNodeHealth {
  endpointId: string;
  url: string;
  name: string;
  network: "mainnet" | "testnet" | "futurenet";
  status: RPCNodeStatus;
  quality: ConnectionQuality;
  latencyMs: number | null;
  lastCheckedAt: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastError: string | null;
  historicalLatency: number[];
  uptimePercent: number;
}

export interface RPCHealthWorkerMessage {
  type:
    | "PROBE_ALL"
    | "ADD_ENDPOINT"
    | "REMOVE_ENDPOINT"
    | "UPDATE_CONFIG"
    | "RESET";
  payload?: unknown;
}

export interface RPCHealthWorkerResponse {
  type: "HEALTH_UPDATE" | "WORKER_ERROR" | "WORKER_READY";
  payload: unknown;
}

export interface HealthCheckResult {
  endpointId: string;
  url: string;
  success: boolean;
  latencyMs: number;
  error: string | null;
  timestamp: number;
}

export interface RPCHealthMonitorConfig {
  endpoints: RPCEndpointConfig[];
  globalIntervalMs?: number;
  globalTimeoutMs?: number;
  maxHistoricalDataPoints?: number;
  degradedLatencyThresholdMs?: number;
  criticalLatencyThresholdMs?: number;
  failureThreshold?: number;
}

export interface RPCHealthState {
  nodes: Map<string, RPCNodeHealth>;
  overallStatus: OverallStatus;
  lastUpdatedAt: number | null;
  isWorkerActive: boolean;
  isLoading: boolean;
  error: string | null;
}

export type WorkerMode = "worker" | "inline-fallback";
