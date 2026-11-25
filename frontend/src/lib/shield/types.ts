/**
 * Rate Limiting & Anti-DDoS Shield — Type Definitions
 *
 * Shared contracts for the off-main-thread shield engine, the worker bridge,
 * the React hook, and the dashboard UI. Keeping every shape in one module lets
 * the worker and its main-thread fallback share a single source of truth.
 */

/** Threat severity, ordered from calm to critical. */
export type ThreatLevel = 'normal' | 'elevated' | 'high' | 'critical';

/** Verdict the engine returns for a single inspected request. */
export type Verdict = 'allow' | 'throttle' | 'block';

/** A single inbound request observation fed into the engine. */
export interface RequestEvent {
  /** Stable client identifier (IP, session id, wallet, …). */
  clientId: string;
  /** Epoch milliseconds when the request was observed. */
  timestamp: number;
  /** Request weight/cost. Defaults to 1 when omitted. */
  cost?: number;
  /** Optional route/path used for per-route analytics. */
  path?: string;
}

/**
 * Rate limiting configuration. Combines a sliding-window limiter with a
 * token-bucket burst allowance so short spikes are tolerated while sustained
 * floods are throttled.
 */
export interface ShieldConfig {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Maximum allowed cost per client within the window. */
  maxRequestsPerWindow: number;
  /** Token bucket capacity (burst allowance). */
  burstCapacity: number;
  /** Token bucket refill rate in tokens per second. */
  refillPerSecond: number;
  /**
   * Fraction (0–1) of total traffic a single client may represent before it is
   * flagged as a concentration anomaly (possible single-source flood).
   */
  concentrationThreshold: number;
  /**
   * Global requests-per-second across all clients above which the system is
   * considered to be under volumetric attack.
   */
  globalRpsThreshold: number;
  /** Clients idle for longer than this (ms) are evicted to bound memory. */
  evictionMs: number;
}

/** Per-client rolling state tracked by the engine. */
export interface ClientState {
  clientId: string;
  /** Timestamps (ms) of recent requests inside the window. */
  windowHits: number[];
  /** Total cost accumulated inside the current window. */
  windowCost: number;
  /** Remaining tokens in the burst bucket. */
  tokens: number;
  /** Last time (ms) the bucket was refilled. */
  lastRefill: number;
  /** Last time (ms) this client was seen. */
  lastSeen: number;
  /** Cumulative blocked count for this client. */
  blocked: number;
  /** Whether the client is currently in a cooldown block. */
  blockedUntil: number;
}

/** Result of inspecting a single request. */
export interface InspectionResult {
  clientId: string;
  verdict: Verdict;
  /** Machine-readable reason for the verdict. */
  reason:
    | 'within-limits'
    | 'window-exceeded'
    | 'burst-exhausted'
    | 'cooldown'
    | 'concentration';
  /** Tokens remaining after this request. */
  remainingTokens: number;
  /** When the client may retry (epoch ms), if blocked/throttled. */
  retryAfter: number;
}

/** Aggregate, dashboard-facing snapshot produced after each batch. */
export interface ShieldSnapshot {
  /** Epoch ms the snapshot was generated. */
  timestamp: number;
  threatLevel: ThreatLevel;
  /** Estimated global requests per second. */
  requestsPerSecond: number;
  totalRequests: number;
  allowed: number;
  throttled: number;
  blocked: number;
  /** Number of clients currently tracked. */
  activeClients: number;
  /** Clients responsible for the most traffic, descending. */
  topOffenders: OffenderSummary[];
  /** Active anomaly signals contributing to the threat level. */
  anomalies: Anomaly[];
}

export interface OffenderSummary {
  clientId: string;
  requests: number;
  blocked: number;
  /** Share of total traffic in range 0–1. */
  share: number;
}

export interface Anomaly {
  type: 'volumetric' | 'concentration' | 'burst';
  clientId?: string;
  message: string;
  /** Normalized severity 0–1. */
  severity: number;
}

/** Health of the worker bridge, surfaced to the UI for resilience. */
export interface ShieldWorkerHealth {
  /** Whether requests are being processed off the main thread. */
  offMainThread: boolean;
  /** True once the engine has produced at least one snapshot. */
  ready: boolean;
  /** Count of recovered worker failures. */
  recoveredErrors: number;
  /** Last error message, if any. */
  lastError: string | null;
}

/** Messages sent from the host to the worker. */
export type ShieldRequestMessage =
  | { type: 'configure'; config: ShieldConfig }
  | { type: 'ingest'; events: RequestEvent[] }
  | { type: 'reset' };

/** Messages emitted from the worker back to the host. */
export type ShieldResponseMessage =
  | { type: 'snapshot'; snapshot: ShieldSnapshot; results: InspectionResult[] }
  | { type: 'error'; message: string };

export const DEFAULT_SHIELD_CONFIG: ShieldConfig = {
  windowMs: 10_000,
  maxRequestsPerWindow: 100,
  burstCapacity: 40,
  refillPerSecond: 20,
  concentrationThreshold: 0.4,
  globalRpsThreshold: 200,
  evictionMs: 60_000,
};
