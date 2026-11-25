/**
 * Tests for the resilient profitability data source: retries, backoff, the
 * circuit breaker, stale-while-error caching, timeouts and abort handling.
 */

import { createResilientSource } from '../resilientSource';
import type { KeeperEconomicsRecord } from '../types';

const goodRecords: KeeperEconomicsRecord[] = [
  { keeperId: 'a', executions: 10, successfulExecutions: 9, cost: 5, revenue: 20 },
  { keeperId: 'b', executions: 20, successfulExecutions: 18, cost: 10, revenue: 8 },
];

/** Deterministic deps: instant sleep, fixed jitter, controllable clock. */
function makeDeps(fetcher: jest.Mock, clock = { t: 1_000 }) {
  return {
    fetcher: fetcher as unknown as (signal?: AbortSignal) => Promise<KeeperEconomicsRecord[]>,
    sleep: jest.fn(async () => undefined),
    random: () => 0.5,
    now: () => clock.t,
  };
}

describe('createResilientSource — success paths', () => {
  it('returns live data on success and caches it', async () => {
    const fetcher = jest.fn().mockResolvedValue(goodRecords);
    const deps = makeDeps(fetcher);
    const source = createResilientSource(deps);

    const result = await source.fetch();
    expect(result.status).toBe('live');
    expect(result.points).toHaveLength(2);
    expect(result.fromCache).toBe(false);
    expect(result.error).toBeNull();
    expect(source.getState().consecutiveFailures).toBe(0);
  });

  it('marks the result degraded when some records are invalid', async () => {
    const fetcher = jest.fn().mockResolvedValue([...goodRecords, { keeperId: 'bad' }]);
    const source = createResilientSource(makeDeps(fetcher));
    const result = await source.fetch();
    expect(result.status).toBe('degraded');
    expect(result.droppedRecords).toBe(1);
    expect(result.points).toHaveLength(2);
  });
});

describe('createResilientSource — retries & backoff', () => {
  it('retries on failure and succeeds, sleeping between attempts', async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error('partition'))
      .mockRejectedValueOnce(new Error('partition'))
      .mockResolvedValue(goodRecords);
    const deps = makeDeps(fetcher);
    const source = createResilientSource({ ...deps, config: { maxRetries: 2 } });

    const result = await source.fetch();
    expect(result.status).toBe('live');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff bounded by maxDelayMs', async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(goodRecords);
    const deps = makeDeps(fetcher);
    const source = createResilientSource({
      ...deps,
      config: { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 150 },
    });
    await source.fetch();
    // jitter = random()(0.5) * min(maxDelay, base*2^attempt)
    expect(deps.sleep).toHaveBeenNthCalledWith(1, 50); // 0.5 * 100
    expect(deps.sleep).toHaveBeenNthCalledWith(2, 75); // 0.5 * min(150, 200)
  });
});

describe('createResilientSource — degradation', () => {
  it('returns offline with an error when all attempts fail and no cache exists', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('RPC down'));
    const source = createResilientSource({ ...makeDeps(fetcher), config: { maxRetries: 1 } });
    const result = await source.fetch();
    expect(result.status).toBe('offline');
    expect(result.points).toEqual([]);
    expect(result.error).toContain('RPC down');
  });

  it('serves stale cache when the source fails after a prior success', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(goodRecords)
      .mockRejectedValue(new Error('RPC down'));
    const source = createResilientSource({ ...makeDeps(fetcher), config: { maxRetries: 0 } });

    await source.fetch(); // primes cache
    const result = await source.fetch();
    expect(result.status).toBe('stale');
    expect(result.fromCache).toBe(true);
    expect(result.points).toHaveLength(2);
    expect(result.error).toContain('RPC down');
  });

  it('treats cache older than the TTL as unusable', async () => {
    const clock = { t: 1_000 };
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(goodRecords)
      .mockRejectedValue(new Error('down'));
    const source = createResilientSource({
      ...makeDeps(fetcher, clock),
      config: { maxRetries: 0, cacheTtlMs: 1_000 },
    });

    await source.fetch();
    clock.t += 5_000; // cache now expired
    const result = await source.fetch();
    expect(result.status).toBe('offline');
  });
});

describe('createResilientSource — circuit breaker', () => {
  it('opens after the failure threshold and skips the source while open', async () => {
    const clock = { t: 1_000 };
    const fetcher = jest.fn().mockRejectedValue(new Error('down'));
    const source = createResilientSource({
      ...makeDeps(fetcher, clock),
      config: { maxRetries: 0, failureThreshold: 2, circuitCooldownMs: 10_000 },
    });

    await source.fetch(); // failure 1
    const second = await source.fetch(); // failure 2 -> trips
    expect(second.circuitOpen).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // While open, the source is not called again.
    const third = await source.fetch();
    expect(third.circuitOpen).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries the source once the cooldown elapses', async () => {
    const clock = { t: 1_000 };
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(goodRecords);
    const source = createResilientSource({
      ...makeDeps(fetcher, clock),
      config: { maxRetries: 0, failureThreshold: 2, circuitCooldownMs: 10_000 },
    });

    await source.fetch();
    await source.fetch(); // trips circuit
    clock.t += 11_000; // cooldown elapsed
    const result = await source.fetch();
    expect(result.status).toBe('live');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('reset clears cache and breaker state', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('down'));
    const source = createResilientSource({
      ...makeDeps(fetcher),
      config: { maxRetries: 0, failureThreshold: 1 },
    });
    await source.fetch();
    expect(source.getState().consecutiveFailures).toBe(1);
    source.reset();
    expect(source.getState().consecutiveFailures).toBe(0);
    expect(source.getState().circuitOpenUntil).toBe(0);
  });
});

describe('createResilientSource — cancellation & timeout', () => {
  it('stops retrying when the caller aborts', async () => {
    const controller = new AbortController();
    const fetcher = jest.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    });
    const source = createResilientSource({ ...makeDeps(fetcher), config: { maxRetries: 5 } });
    const result = await source.fetch(controller.signal);
    expect(fetcher).toHaveBeenCalledTimes(1); // no retries after abort
    expect(result.status).toBe('offline');
  });

  it('times out a hung fetch via the abort signal', async () => {
    // Fetcher resolves only if the signal never aborts; otherwise it rejects.
    const fetcher = jest.fn((signal?: AbortSignal) =>
      new Promise<KeeperEconomicsRecord[]>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')));
        // never resolves on its own
      }),
    );
    const source = createResilientSource({
      ...makeDeps(fetcher),
      sleep: async () => undefined,
      config: { maxRetries: 0, timeoutMs: 5 },
    });
    const result = await source.fetch();
    expect(result.status).toBe('offline');
    expect(result.error).toMatch(/timed out|aborted/i);
  });
});
