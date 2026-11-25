/**
 * Unit tests for the shield engine. The engine is pure with respect to time,
 * so every scenario passes explicit timestamps for deterministic assertions.
 */

import { ShieldEngine, normalizeConfig } from '../engine';
import { DEFAULT_SHIELD_CONFIG, RequestEvent } from '../types';

const evt = (clientId: string, timestamp: number, cost?: number): RequestEvent => ({
  clientId,
  timestamp,
  cost,
});

describe('normalizeConfig', () => {
  it('returns defaults for an empty config', () => {
    expect(normalizeConfig()).toEqual(DEFAULT_SHIELD_CONFIG);
  });

  it('replaces invalid numeric fields with defaults', () => {
    const cfg = normalizeConfig({
      windowMs: -1,
      maxRequestsPerWindow: 0,
      refillPerSecond: Number.NaN,
      globalRpsThreshold: Infinity as unknown as number,
    });
    expect(cfg.windowMs).toBe(DEFAULT_SHIELD_CONFIG.windowMs);
    expect(cfg.maxRequestsPerWindow).toBe(DEFAULT_SHIELD_CONFIG.maxRequestsPerWindow);
    expect(cfg.refillPerSecond).toBe(DEFAULT_SHIELD_CONFIG.refillPerSecond);
    expect(cfg.globalRpsThreshold).toBe(DEFAULT_SHIELD_CONFIG.globalRpsThreshold);
  });

  it('clamps the concentration threshold to 0–1', () => {
    expect(normalizeConfig({ concentrationThreshold: 5 }).concentrationThreshold).toBe(1);
    expect(normalizeConfig({ concentrationThreshold: -2 }).concentrationThreshold).toBe(0);
    expect(normalizeConfig({ concentrationThreshold: NaN }).concentrationThreshold).toBe(
      DEFAULT_SHIELD_CONFIG.concentrationThreshold,
    );
  });
});

describe('ShieldEngine.inspect', () => {
  it('allows traffic within limits', () => {
    const engine = new ShieldEngine();
    const result = engine.inspect(evt('a', 1000));
    expect(result.verdict).toBe('allow');
    expect(result.reason).toBe('within-limits');
    expect(engine.trackedClients).toBe(1);
  });

  it('throttles once the burst bucket is exhausted', () => {
    const engine = new ShieldEngine({
      burstCapacity: 3,
      refillPerSecond: 0.001, // effectively no refill within the test window
      maxRequestsPerWindow: 1000,
    });
    const verdicts = [0, 1, 2, 3, 4].map((i) => engine.inspect(evt('a', 1000 + i)).verdict);
    expect(verdicts.slice(0, 3)).toEqual(['allow', 'allow', 'allow']);
    expect(verdicts.slice(3)).toEqual(['throttle', 'throttle']);
  });

  it('refills tokens over time', () => {
    const engine = new ShieldEngine({
      burstCapacity: 2,
      refillPerSecond: 2,
      maxRequestsPerWindow: 1000,
    });
    engine.inspect(evt('a', 0));
    engine.inspect(evt('a', 0));
    expect(engine.inspect(evt('a', 0)).verdict).toBe('throttle');
    // After 1s, 2 tokens refill.
    expect(engine.inspect(evt('a', 1000)).verdict).toBe('allow');
  });

  it('blocks when the sliding window is exceeded and applies a cooldown', () => {
    const engine = new ShieldEngine({
      maxRequestsPerWindow: 2,
      burstCapacity: 100,
      refillPerSecond: 100,
      windowMs: 10_000,
    });
    expect(engine.inspect(evt('a', 0)).verdict).toBe('allow');
    expect(engine.inspect(evt('a', 1)).verdict).toBe('allow');
    const blocked = engine.inspect(evt('a', 2));
    expect(blocked.verdict).toBe('block');
    expect(blocked.reason).toBe('window-exceeded');
    // Subsequent request during cooldown is blocked with the cooldown reason.
    const cooled = engine.inspect(evt('a', 100));
    expect(cooled.verdict).toBe('block');
    expect(cooled.reason).toBe('cooldown');
  });

  it('expires window hits once the window slides past them', () => {
    const engine = new ShieldEngine({
      maxRequestsPerWindow: 2,
      burstCapacity: 100,
      refillPerSecond: 100,
      windowMs: 1000,
    });
    engine.inspect(evt('a', 0));
    engine.inspect(evt('a', 500));
    // 2000ms later both prior hits have expired, so this is allowed again.
    expect(engine.inspect(evt('a', 2000)).verdict).toBe('allow');
  });

  it('sanitizes malformed client ids and costs', () => {
    const engine = new ShieldEngine();
    const result = engine.inspect({
      clientId: '   ',
      timestamp: 1000,
      cost: -5,
    } as RequestEvent);
    expect(result.clientId).toBe('unknown');
    expect(result.verdict).toBe('allow');
  });

  it('respects an explicit per-request cost', () => {
    const engine = new ShieldEngine({
      burstCapacity: 5,
      refillPerSecond: 0.001,
      maxRequestsPerWindow: 1000,
    });
    expect(engine.inspect(evt('a', 0, 5)).verdict).toBe('allow');
    expect(engine.inspect(evt('a', 0, 1)).verdict).toBe('throttle');
  });
});

describe('ShieldEngine.snapshot', () => {
  it('aggregates verdict counters and resets them', () => {
    const engine = new ShieldEngine({ maxRequestsPerWindow: 1, burstCapacity: 100, refillPerSecond: 100 });
    engine.inspect(evt('a', 0));
    engine.inspect(evt('a', 1)); // exceeds window -> block
    const snap = engine.snapshot(2);
    expect(snap.allowed).toBe(1);
    expect(snap.blocked).toBe(1);
    expect(snap.totalRequests).toBe(2);
    // Counters reset on snapshot.
    const next = engine.snapshot(3);
    expect(next.totalRequests).toBe(0);
  });

  it('flags a volumetric anomaly and critical threat under heavy load', () => {
    const engine = new ShieldEngine({
      globalRpsThreshold: 5,
      maxRequestsPerWindow: 10_000,
      burstCapacity: 10_000,
      refillPerSecond: 10_000,
    });
    for (let i = 0; i < 50; i++) {
      engine.inspect(evt(`client-${i % 5}`, i)); // 50 events across 50ms => ~1000 rps
    }
    const snap = engine.snapshot(60);
    expect(snap.requestsPerSecond).toBeGreaterThan(5);
    expect(snap.anomalies.some((a) => a.type === 'volumetric')).toBe(true);
    expect(snap.threatLevel).toBe('critical');
  });

  it('flags a concentration anomaly when one client dominates', () => {
    const engine = new ShieldEngine({
      concentrationThreshold: 0.4,
      maxRequestsPerWindow: 10_000,
      burstCapacity: 10_000,
      refillPerSecond: 10_000,
    });
    for (let i = 0; i < 8; i++) engine.inspect(evt('whale', i));
    engine.inspect(evt('other', 9));
    const snap = engine.snapshot(10);
    const concentration = snap.anomalies.find((a) => a.type === 'concentration');
    expect(concentration?.clientId).toBe('whale');
    expect(snap.topOffenders[0].clientId).toBe('whale');
  });

  it('reports normal threat level with diverse, low-volume traffic', () => {
    const engine = new ShieldEngine();
    // Five distinct clients spaced one second apart: ~1 rps, 20% share each.
    for (let i = 0; i < 5; i++) engine.inspect(evt(`client-${i}`, i * 1000));
    const snap = engine.snapshot(5000);
    expect(snap.threatLevel).toBe('normal');
    expect(snap.anomalies).toHaveLength(0);
  });

  it('estimates rps as total when all events share a timestamp', () => {
    const engine = new ShieldEngine();
    engine.inspect(evt('a', 1000));
    engine.inspect(evt('b', 1000));
    expect(engine.snapshot(1000).requestsPerSecond).toBe(2);
  });

  it('returns zero rps when no events were seen', () => {
    expect(new ShieldEngine().snapshot(0).requestsPerSecond).toBe(0);
  });

  it('evicts stale clients to bound memory', () => {
    const engine = new ShieldEngine({ evictionMs: 1000 });
    engine.inspect(evt('a', 0));
    expect(engine.trackedClients).toBe(1);
    engine.snapshot(5000); // a is stale
    expect(engine.trackedClients).toBe(0);
  });
});

describe('ShieldEngine lifecycle', () => {
  it('reconfigures at runtime', () => {
    const engine = new ShieldEngine();
    engine.configure({ maxRequestsPerWindow: 1 });
    expect(engine.getConfig().maxRequestsPerWindow).toBe(1);
  });

  it('resets all state', () => {
    const engine = new ShieldEngine();
    engine.inspectBatch([evt('a', 0), evt('b', 1)]);
    engine.reset();
    expect(engine.trackedClients).toBe(0);
    expect(engine.snapshot(2).totalRequests).toBe(0);
  });

  it('inspectBatch returns one result per event', () => {
    const engine = new ShieldEngine();
    const results = engine.inspectBatch([evt('a', 0), evt('b', 1)], 2);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.clientId)).toEqual(['a', 'b']);
  });
});
