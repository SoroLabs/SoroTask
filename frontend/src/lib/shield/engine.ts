/**
 * Rate Limiting & Anti-DDoS Shield — Core Engine
 *
 * A dependency-free, deterministic engine that powers the shield. It is pure
 * with respect to wall-clock time (every method takes an explicit `now`), which
 * makes it trivially testable and lets it run identically inside a Web Worker
 * or on the main thread as a fallback.
 *
 * Algorithm overview:
 *  - Sliding window: bounds sustained cost per client over `windowMs`.
 *  - Token bucket: absorbs short bursts up to `burstCapacity`, refilling at
 *    `refillPerSecond`.
 *  - Concentration detection: flags a single client dominating total traffic.
 *  - Volumetric detection: flags global RPS above `globalRpsThreshold`.
 */

import {
  Anomaly,
  ClientState,
  InspectionResult,
  OffenderSummary,
  RequestEvent,
  ShieldConfig,
  ShieldSnapshot,
  ThreatLevel,
  Verdict,
  DEFAULT_SHIELD_CONFIG,
} from './types';

/** Cooldown applied after a client is blocked, in milliseconds. */
const BLOCK_COOLDOWN_MS = 5_000;

/** Validate and normalize a (possibly partial/untrusted) config. */
export function normalizeConfig(config: Partial<ShieldConfig> = {}): ShieldConfig {
  const merged = { ...DEFAULT_SHIELD_CONFIG, ...config };
  return {
    windowMs: clampPositive(merged.windowMs, DEFAULT_SHIELD_CONFIG.windowMs),
    maxRequestsPerWindow: clampPositive(
      merged.maxRequestsPerWindow,
      DEFAULT_SHIELD_CONFIG.maxRequestsPerWindow,
    ),
    burstCapacity: clampPositive(merged.burstCapacity, DEFAULT_SHIELD_CONFIG.burstCapacity),
    refillPerSecond: clampPositive(
      merged.refillPerSecond,
      DEFAULT_SHIELD_CONFIG.refillPerSecond,
    ),
    concentrationThreshold: clamp01(merged.concentrationThreshold),
    globalRpsThreshold: clampPositive(
      merged.globalRpsThreshold,
      DEFAULT_SHIELD_CONFIG.globalRpsThreshold,
    ),
    evictionMs: clampPositive(merged.evictionMs, DEFAULT_SHIELD_CONFIG.evictionMs),
  };
}

function clampPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SHIELD_CONFIG.concentrationThreshold;
  return Math.min(1, Math.max(0, value));
}

export class ShieldEngine {
  private config: ShieldConfig;
  private readonly clients = new Map<string, ClientState>();

  // Rolling counters reset on every snapshot so the dashboard sees per-batch deltas.
  private allowed = 0;
  private throttled = 0;
  private blocked = 0;
  private total = 0;
  private firstEventTs = 0;
  private lastEventTs = 0;

  constructor(config: Partial<ShieldConfig> = {}) {
    this.config = normalizeConfig(config);
  }

  /** Replace the active configuration. */
  configure(config: Partial<ShieldConfig>): void {
    this.config = normalizeConfig(config);
  }

  getConfig(): ShieldConfig {
    return { ...this.config };
  }

  /** Drop all state. */
  reset(): void {
    this.clients.clear();
    this.resetCounters();
  }

  private resetCounters(): void {
    this.allowed = 0;
    this.throttled = 0;
    this.blocked = 0;
    this.total = 0;
    this.firstEventTs = 0;
    this.lastEventTs = 0;
  }

  /** Number of tracked clients (primarily for tests/diagnostics). */
  get trackedClients(): number {
    return this.clients.size;
  }

  /**
   * Inspect a single request and return a verdict. Mutates client state.
   * Safe against malformed input: missing/invalid fields are coerced.
   */
  inspect(event: RequestEvent, now: number = event.timestamp): InspectionResult {
    const clientId = sanitizeClientId(event.clientId);
    const cost = sanitizeCost(event.cost);
    const ts = Number.isFinite(event.timestamp) ? event.timestamp : now;

    const state = this.touchClient(clientId, ts);
    this.total += 1;
    if (this.firstEventTs === 0) this.firstEventTs = ts;
    this.lastEventTs = Math.max(this.lastEventTs, ts);

    // Honour an active cooldown before doing any other work.
    if (ts < state.blockedUntil) {
      state.blocked += 1;
      this.blocked += 1;
      return result(clientId, 'block', 'cooldown', state.tokens, state.blockedUntil);
    }

    this.refill(state, ts);
    this.expireWindow(state, ts);

    // Sliding window check: sustained traffic.
    if (state.windowCost + cost > this.config.maxRequestsPerWindow) {
      this.applyBlock(state, ts);
      return result(
        clientId,
        'block',
        'window-exceeded',
        state.tokens,
        state.blockedUntil,
      );
    }

    // Token bucket check: burst traffic.
    if (state.tokens < cost) {
      this.throttled += 1;
      const retryAfter = ts + Math.ceil((cost / this.config.refillPerSecond) * 1000);
      return result(clientId, 'throttle', 'burst-exhausted', state.tokens, retryAfter);
    }

    // Accept the request.
    state.tokens -= cost;
    state.windowHits.push(ts);
    state.windowCost += cost;
    this.allowed += 1;
    return result(clientId, 'allow', 'within-limits', state.tokens, 0);
  }

  /** Inspect a batch and return per-request results. */
  inspectBatch(events: RequestEvent[], now: number = Date.now()): InspectionResult[] {
    const results: InspectionResult[] = [];
    for (const event of events) {
      results.push(this.inspect(event, now));
    }
    return results;
  }

  /**
   * Produce an aggregate snapshot and reset rolling counters. Evicts stale
   * clients to keep memory bounded under long-running attacks.
   */
  snapshot(now: number = Date.now()): ShieldSnapshot {
    this.evictStale(now);

    const requestsPerSecond = this.estimateRps();
    const topOffenders = this.computeOffenders();
    const anomalies = this.detectAnomalies(requestsPerSecond, topOffenders);
    const threatLevel = this.deriveThreatLevel(requestsPerSecond, anomalies);

    const snapshot: ShieldSnapshot = {
      timestamp: now,
      threatLevel,
      requestsPerSecond,
      totalRequests: this.total,
      allowed: this.allowed,
      throttled: this.throttled,
      blocked: this.blocked,
      activeClients: this.clients.size,
      topOffenders,
      anomalies,
    };

    this.resetCounters();
    return snapshot;
  }

  // — internal helpers —————————————————————————————————————————————

  private touchClient(clientId: string, ts: number): ClientState {
    let state = this.clients.get(clientId);
    if (!state) {
      state = {
        clientId,
        windowHits: [],
        windowCost: 0,
        tokens: this.config.burstCapacity,
        lastRefill: ts,
        lastSeen: ts,
        blocked: 0,
        blockedUntil: 0,
      };
      this.clients.set(clientId, state);
    }
    state.lastSeen = Math.max(state.lastSeen, ts);
    return state;
  }

  private refill(state: ClientState, ts: number): void {
    const elapsed = Math.max(0, ts - state.lastRefill);
    if (elapsed === 0) return;
    const refill = (elapsed / 1000) * this.config.refillPerSecond;
    state.tokens = Math.min(this.config.burstCapacity, state.tokens + refill);
    state.lastRefill = ts;
  }

  private expireWindow(state: ClientState, ts: number): void {
    const cutoff = ts - this.config.windowMs;
    if (state.windowHits.length === 0) return;
    let removed = 0;
    while (state.windowHits.length > 0 && state.windowHits[0] <= cutoff) {
      state.windowHits.shift();
      removed += 1;
    }
    if (removed > 0) {
      // windowCost tracks unit cost-per-hit approximation; recompute from hits.
      state.windowCost = state.windowHits.length;
    }
  }

  private applyBlock(state: ClientState, ts: number): void {
    state.blocked += 1;
    this.blocked += 1;
    state.blockedUntil = ts + BLOCK_COOLDOWN_MS;
  }

  private evictStale(now: number): void {
    for (const [id, state] of this.clients) {
      if (now - state.lastSeen > this.config.evictionMs) {
        this.clients.delete(id);
      }
    }
  }

  private estimateRps(): number {
    const spanMs = Math.max(1, this.lastEventTs - this.firstEventTs);
    if (this.total === 0) return 0;
    // When all events share a timestamp (synthetic/batched), fall back to total.
    if (this.lastEventTs === this.firstEventTs) return this.total;
    return (this.total / spanMs) * 1000;
  }

  private computeOffenders(limit = 5): OffenderSummary[] {
    const offenders: OffenderSummary[] = [];
    for (const state of this.clients.values()) {
      const requests = state.windowHits.length + state.blocked;
      if (requests === 0) continue;
      offenders.push({
        clientId: state.clientId,
        requests,
        blocked: state.blocked,
        share: this.total === 0 ? 0 : requests / this.total,
      });
    }
    offenders.sort((a, b) => b.requests - a.requests);
    return offenders.slice(0, limit);
  }

  private detectAnomalies(rps: number, offenders: OffenderSummary[]): Anomaly[] {
    const anomalies: Anomaly[] = [];

    if (rps > this.config.globalRpsThreshold) {
      anomalies.push({
        type: 'volumetric',
        message: `Global traffic ${Math.round(rps)} rps exceeds threshold ${this.config.globalRpsThreshold} rps`,
        severity: clamp01(rps / (this.config.globalRpsThreshold * 2)),
      });
    }

    const dominant = offenders[0];
    if (dominant && dominant.share >= this.config.concentrationThreshold) {
      anomalies.push({
        type: 'concentration',
        clientId: dominant.clientId,
        message: `Client ${dominant.clientId} accounts for ${(dominant.share * 100).toFixed(0)}% of traffic`,
        severity: clamp01(dominant.share),
      });
    }

    if (this.blocked > 0 && this.total > 0 && this.blocked / this.total > 0.25) {
      anomalies.push({
        type: 'burst',
        message: `${this.blocked} of ${this.total} requests blocked this cycle`,
        severity: clamp01(this.blocked / this.total),
      });
    }

    return anomalies;
  }

  private deriveThreatLevel(rps: number, anomalies: Anomaly[]): ThreatLevel {
    if (anomalies.length === 0) return 'normal';
    const peak = anomalies.reduce((max, a) => Math.max(max, a.severity), 0);
    const volumetric = anomalies.some((a) => a.type === 'volumetric');
    if (peak >= 0.75 || (volumetric && rps > this.config.globalRpsThreshold * 1.5)) {
      return 'critical';
    }
    if (peak >= 0.5 || volumetric) return 'high';
    return 'elevated';
  }
}

function sanitizeClientId(clientId: unknown): string {
  if (typeof clientId === 'string' && clientId.trim().length > 0) {
    return clientId.trim().slice(0, 128);
  }
  return 'unknown';
}

function sanitizeCost(cost: unknown): number {
  if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) {
    return Math.min(cost, 1000);
  }
  return 1;
}

function result(
  clientId: string,
  verdict: Verdict,
  reason: InspectionResult['reason'],
  remainingTokens: number,
  retryAfter: number,
): InspectionResult {
  return {
    clientId,
    verdict,
    reason,
    remainingTokens: Math.max(0, Math.floor(remainingTokens)),
    retryAfter,
  };
}
