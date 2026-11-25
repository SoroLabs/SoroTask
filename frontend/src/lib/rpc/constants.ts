import type { RPCHealthMonitorConfig, RPCEndpointConfig } from "./types";

export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 15_000;
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_HISTORICAL_DATA_POINTS = 60;
export const DEFAULT_DEGRADED_LATENCY_THRESHOLD_MS = 500;
export const DEFAULT_CRITICAL_LATENCY_THRESHOLD_MS = 2000;
export const DEFAULT_FAILURE_THRESHOLD = 3;

export const DEFAULT_ENDPOINTS: RPCEndpointConfig[] = [
  {
    id: "soroban-mainnet",
    url: "https://soroban-rpc.mainnet.stellar.gateway.com",
    name: "Soroban Mainnet",
    network: "mainnet",
  },
  {
    id: "soroban-testnet",
    url: "https://soroban-rpc.testnet.stellar.gateway.com",
    name: "Soroban Testnet",
    network: "testnet",
  },
  {
    id: "soroban-futurenet",
    url: "https://soroban-rpc.futurenet.stellar.gateway.com",
    name: "Soroban Futurenet",
    network: "futurenet",
  },
];

export const DEFAULT_RPC_MONITOR_CONFIG: Required<RPCHealthMonitorConfig> = {
  endpoints: DEFAULT_ENDPOINTS,
  globalIntervalMs: DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  globalTimeoutMs: DEFAULT_TIMEOUT_MS,
  maxHistoricalDataPoints: DEFAULT_MAX_HISTORICAL_DATA_POINTS,
  degradedLatencyThresholdMs: DEFAULT_DEGRADED_LATENCY_THRESHOLD_MS,
  criticalLatencyThresholdMs: DEFAULT_CRITICAL_LATENCY_THRESHOLD_MS,
  failureThreshold: DEFAULT_FAILURE_THRESHOLD,
};
