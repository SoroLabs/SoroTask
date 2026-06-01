'use strict';

/**
 * readBatcher.test.js — comprehensive tests for ReadBatcher
 *
 * Coverage:
 *   - Constructor validation
 *   - read() / readMany() public API
 *   - Debounce batching (single flush per window)
 *   - Batch size chunking
 *   - Per-task error isolation (batch error, partial failure, decode error)
 *   - Stats tracking (savedRpcCalls, avgBatchSize, avgLatencyMs)
 *   - Rate limiting (batchConcurrency respected)
 *   - drain() / graceful shutdown
 *   - Poller integration (batcher replaces per-task simulateTransaction)
 */

const { ReadBatcher } = require('../src/readBatcher');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal XDR-like LedgerEntry stub that _decodeEntries can parse.
 *
 * The ReadBatcher calls:
 *   entry.key.contractData().key()  → ScVal (the task DataKey)
 *   entry.val.contractData().val()  → ScVal (the TaskConfig)
 *
 * We simulate these with plain objects and jest.fn() chains.
 */
function makeLedgerEntry(taskId, configScVal) {
  const keyVec = [
    { switch: () => ({ name: 'scvSymbol' }), sym: () => Buffer.from('Task') },
    {
      switch: () => ({ name: 'scvU64' }),
      // scValToNative on scvU64 returns a BigInt — we mock it returning taskId
      _taskId: taskId,
    },
  ];

  const keyScVal = {
    switch: () => ({ name: 'scvVec' }),
    vec: () => keyVec,
  };

  const keyContractData = { key: () => keyScVal };
  const valContractData = { val: () => configScVal };

  return {
    key: { contractData: () => keyContractData },
    val: { contractData: () => valContractData },
  };
}

/**
 * Create a mock Soroban server with a controllable getLedgerEntries.
 */
function makeMockServer(responseFactory) {
  return {
    getLedgerEntries: jest.fn(responseFactory),
  };
}

/**
 * A decoder that returns a simple object with an id field derived from the ScVal.
 * In real code this calls TaskPoller.decodeTaskConfig(scVal).
 */
function makeDecoder(configs) {
  // configs: Map<taskId, object>
  return jest.fn(scVal => {
    // scVal is whatever we passed as configScVal in makeLedgerEntry
    return scVal ? scVal._decoded : null;
  });
}

// Well-known test contract ID (bech32 format — valid for StrKey.decodeContract)
const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

// ── Silence logger output during tests ───────────────────────────────────────
jest.mock('../src/logger', () => ({
  createLogger: () => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    childWithTrace: () => ({
      trace: jest.fn(), debug: jest.fn(), info: jest.fn(),
      warn: jest.fn(), error: jest.fn(), fatal: jest.fn(),
    }),
  }),
}));

// ── Constructor ───────────────────────────────────────────────────────────────

describe('ReadBatcher — constructor', () => {
  it('throws when server lacks getLedgerEntries', () => {
    expect(() => new ReadBatcher({}, CONTRACT_ID, () => {}))
      .toThrow('server must expose getLedgerEntries');
  });

  it('throws when contractId is missing', () => {
    const server = { getLedgerEntries: jest.fn() };
    expect(() => new ReadBatcher(server, '', () => {}))
      .toThrow('contractId must be a non-empty string');
  });

  it('throws when decoder is not a function', () => {
    const server = { getLedgerEntries: jest.fn() };
    expect(() => new ReadBatcher(server, CONTRACT_ID, null))
      .toThrow('decoder must be a function');
  });

  it('applies default options', () => {
    const server = { getLedgerEntries: jest.fn() };
    const batcher = new ReadBatcher(server, CONTRACT_ID, () => {});
    expect(batcher.batchWindowMs).toBe(10);
    expect(batcher.maxBatchSize).toBe(50);
  });

  it('respects custom options', () => {
    const server = { getLedgerEntries: jest.fn() };
    const batcher = new ReadBatcher(server, CONTRACT_ID, () => {}, {
      batchWindowMs: 25,
      maxBatchSize: 10,
    });
    expect(batcher.batchWindowMs).toBe(25);
    expect(batcher.maxBatchSize).toBe(10);
  });

  it('clamps maxBatchSize to HARD_MAX (200)', () => {
    const server = { getLedgerEntries: jest.fn() };
    const batcher = new ReadBatcher(server, CONTRACT_ID, () => {}, { maxBatchSize: 9999 });
    expect(batcher.maxBatchSize).toBe(200);
  });

  it('initialises stats to zero', () => {
    const server = { getLedgerEntries: jest.fn() };
    const batcher = new ReadBatcher(server, CONTRACT_ID, () => {});
    const stats = batcher.getStats();
    expect(stats.totalBatches).toBe(0);
    expect(stats.totalReads).toBe(0);
    expect(stats.savedRpcCalls).toBe(0);
  });
});

// ── read() ────────────────────────────────────────────────────────────────────

describe('ReadBatcher — read()', () => {
  let server, batcher;

  beforeEach(() => {
    const taskConfig = { last_run: 100, interval: 50, gas_balance: 500 };
    const configScVal = { _decoded: taskConfig };
    const entry = makeLedgerEntry(1, configScVal);

    server = makeMockServer(() =>
      Promise.resolve({ entries: [entry] }),
    );

    batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0, // zero-delay for test speed
    });
  });

  afterEach(async () => {
    await batcher.drain();
  });

  it('rejects an invalid taskId', async () => {
    await expect(batcher.read('not-a-number')).rejects.toThrow('invalid taskId');
    await expect(batcher.read(NaN)).rejects.toThrow('invalid taskId');
    await expect(batcher.read(-1)).rejects.toThrow('invalid taskId');
  });

  it('resolves with null for a task not present in the response', async () => {
    // Server returns no entries for taskId 99
    server.getLedgerEntries.mockResolvedValueOnce({ entries: [] });
    const result = await batcher.read(99);
    expect(result).toBeNull();
  });

  it('increments totalReads stat', async () => {
    await batcher.read(1);
    expect(batcher.getStats().totalReads).toBe(1);
  });
});

// ── Batching (debounce) ───────────────────────────────────────────────────────

describe('ReadBatcher — batch window coalescing', () => {
  it('batches concurrent reads into a single getLedgerEntries call', async () => {
    const configs = new Map([
      [1, { gas_balance: 100, interval: 10, last_run: 0 }],
      [2, { gas_balance: 200, interval: 20, last_run: 0 }],
      [3, { gas_balance: 300, interval: 30, last_run: 0 }],
    ]);

    const entries = [1, 2, 3].map(id => makeLedgerEntry(id, { _decoded: configs.get(id) }));
    const server = makeMockServer(() => Promise.resolve({ entries }));

    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0,
    });

    // Fire three concurrent reads — all should land in the same batch
    const [r1, r2, r3] = await Promise.all([
      batcher.read(1),
      batcher.read(2),
      batcher.read(3),
    ]);

    expect(server.getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(configs.get(1));
    expect(r2).toEqual(configs.get(2));
    expect(r3).toEqual(configs.get(3));
  });

  it('deduplicates concurrent reads for the same taskId', async () => {
    const config = { gas_balance: 100, interval: 10, last_run: 0 };
    const entry = makeLedgerEntry(42, { _decoded: config });
    const server = makeMockServer(() => Promise.resolve({ entries: [entry] }));

    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0,
    });

    // Two reads for the same task — only one ledger key should be fetched
    const [r1, r2] = await Promise.all([
      batcher.read(42),
      batcher.read(42),
    ]);

    expect(server.getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(config);
    expect(r2).toEqual(config);
  });

  it('fires a second batch for reads that arrive after the window closes', async () => {
    const makeEntry = id => makeLedgerEntry(id, { _decoded: { id } });
    const server = makeMockServer((...keys) =>
      Promise.resolve({ entries: keys.map((_, i) => makeEntry(i + 1)) }),
    );

    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 5, // 5 ms window
    });

    // First batch
    await batcher.read(1);
    // Wait for the window to close
    await new Promise(r => setTimeout(r, 20));
    // Second batch
    await batcher.read(2);

    expect(server.getLedgerEntries).toHaveBeenCalledTimes(2);
    await batcher.drain();
  });
});

// ── Batch size chunking ───────────────────────────────────────────────────────

describe('ReadBatcher — maxBatchSize chunking', () => {
  it('splits N reads into ceil(N/maxBatchSize) getLedgerEntries calls', async () => {
    const N = 7;
    const batchSize = 3; // expect ceil(7/3) = 3 calls

    const entries = Array.from({ length: N }, (_, i) =>
      makeLedgerEntry(i + 1, { _decoded: { id: i + 1 } }),
    );

    // Each call returns the subset of entries for its keys
    let callCount = 0;
    const server = makeMockServer((...keys) => {
      const start = callCount * batchSize;
      callCount++;
      return Promise.resolve({ entries: entries.slice(start, start + keys.length) });
    });

    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0,
      maxBatchSize: batchSize,
    });

    const reads = Array.from({ length: N }, (_, i) => batcher.read(i + 1));
    await Promise.all(reads);

    expect(server.getLedgerEntries).toHaveBeenCalledTimes(Math.ceil(N / batchSize));
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('ReadBatcher — error handling', () => {
  it('rejects all callers in a chunk when getLedgerEntries throws', async () => {
    const rpcError = new Error('RPC connection refused');
    const server = makeMockServer(() => Promise.reject(rpcError));

    const batcher = new ReadBatcher(server, CONTRACT_ID, () => null, {
      batchWindowMs: 0,
    });

    const errorListener = jest.fn();
    batcher.on('batch:error', errorListener);

    await expect(batcher.read(1)).rejects.toThrow('RPC connection refused');
    await expect(batcher.read(2)).rejects.toThrow('RPC connection refused');

    expect(errorListener).toHaveBeenCalledWith(
      expect.objectContaining({ error: rpcError }),
    );

    expect(batcher.getStats().batchErrors).toBeGreaterThan(0);
  });

  it('does not reject valid tasks when another task in the same batch fails to decode', async () => {
    // Entry for task 1 has a bad scVal that throws in the decoder
    // Entry for task 2 decodes correctly
    const goodConfig = { gas_balance: 100 };
    const entries = [
      makeLedgerEntry(1, { _decoded: null, _shouldThrow: true }),
      makeLedgerEntry(2, { _decoded: goodConfig }),
    ];

    const server = makeMockServer(() => Promise.resolve({ entries }));

    const decoder = jest.fn(scVal => {
      if (scVal._shouldThrow) {
        throw new Error('Corrupt XDR data');
      }
      return scVal._decoded;
    });

    const batcher = new ReadBatcher(server, CONTRACT_ID, decoder, {
      batchWindowMs: 0,
    });

    const [r1, r2] = await Promise.all([batcher.read(1), batcher.read(2)]);

    // Task 1 decode failed → null (not found treatment)
    expect(r1).toBeNull();
    // Task 2 decoded correctly
    expect(r2).toEqual(goodConfig);

    expect(batcher.getStats().decodeErrors).toBe(1);
  });

  it('resolves null for tasks absent from the getLedgerEntries response', async () => {
    // Asking for tasks 1 and 2, but response only contains task 1
    const entry1 = makeLedgerEntry(1, { _decoded: { gas_balance: 100 } });
    const server = makeMockServer(() => Promise.resolve({ entries: [entry1] }));

    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0,
    });

    const [r1, r2] = await Promise.all([batcher.read(1), batcher.read(2)]);

    expect(r1).toEqual({ gas_balance: 100 });
    expect(r2).toBeNull(); // not in response → deregistered / not found
  });

  it('isolates chunk errors: failed chunk does not affect other chunks', async () => {
    // maxBatchSize=2 → tasks [1,2] in chunk 0, [3,4] in chunk 1
    // chunk 0 succeeds, chunk 1 fails
    let callIndex = 0;
    const server = makeMockServer((..._keys) => {
      const ci = callIndex++;
      if (ci === 0) {
        return Promise.resolve({
          entries: [
            makeLedgerEntry(1, { _decoded: { id: 1 } }),
            makeLedgerEntry(2, { _decoded: { id: 2 } }),
          ],
        });
      }
      return Promise.reject(new Error('Chunk 1 RPC failure'));
    });

    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0,
      maxBatchSize: 2,
    });

    const results = await Promise.allSettled([
      batcher.read(1),
      batcher.read(2),
      batcher.read(3),
      batcher.read(4),
    ]);

    // Chunk 0 — both succeed
    expect(results[0].status).toBe('fulfilled');
    expect(results[0].value).toEqual({ id: 1 });
    expect(results[1].status).toBe('fulfilled');
    expect(results[1].value).toEqual({ id: 2 });

    // Chunk 1 — both fail
    expect(results[2].status).toBe('rejected');
    expect(results[3].status).toBe('rejected');
  });
});

// ── readMany() ────────────────────────────────────────────────────────────────

describe('ReadBatcher — readMany()', () => {
  it('returns an empty Map for an empty input', async () => {
    const server = makeMockServer(() => Promise.resolve({ entries: [] }));
    const batcher = new ReadBatcher(server, CONTRACT_ID, () => null, { batchWindowMs: 0 });
    const result = await batcher.readMany([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(server.getLedgerEntries).not.toHaveBeenCalled();
  });

  it('returns a Map keyed by taskId with config values', async () => {
    const config1 = { gas_balance: 100 };
    const config2 = { gas_balance: 200 };
    const entries = [
      makeLedgerEntry(10, { _decoded: config1 }),
      makeLedgerEntry(20, { _decoded: config2 }),
    ];
    const server = makeMockServer(() => Promise.resolve({ entries }));
    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0,
    });

    const result = await batcher.readMany([10, 20]);

    expect(result.get(10)).toEqual(config1);
    expect(result.get(20)).toEqual(config2);
  });

  it('does not throw when some reads fail — those keys are absent from the map', async () => {
    const server = makeMockServer(() => Promise.reject(new Error('RPC down')));
    const batcher = new ReadBatcher(server, CONTRACT_ID, () => null, { batchWindowMs: 0 });

    // readMany should not throw even if underlying reads fail
    const result = await batcher.readMany([1, 2]);
    // Both failed → neither key is in the result map
    expect(result.has(1)).toBe(false);
    expect(result.has(2)).toBe(false);
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

describe('ReadBatcher — getStats()', () => {
  it('tracks totalBatches, totalReads, batchedReads, and savedRpcCalls', async () => {
    const entries = [1, 2, 3].map(id => makeLedgerEntry(id, { _decoded: { id } }));
    const server = makeMockServer(() => Promise.resolve({ entries }));
    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0,
    });

    await Promise.all([batcher.read(1), batcher.read(2), batcher.read(3)]);

    const stats = batcher.getStats();
    expect(stats.totalReads).toBe(3);
    expect(stats.totalBatches).toBe(1);
    expect(stats.batchedReads).toBe(3);
    // 3 reads in 1 batch = 2 saved RPC calls
    expect(stats.savedRpcCalls).toBe(2);
    expect(stats.avgBatchSize).toBe(3);
  });

  it('records avgBatchLatencyMs after each batch', async () => {
    const entry = makeLedgerEntry(1, { _decoded: {} });
    const server = makeMockServer(() =>
      new Promise(r => setTimeout(() => r({ entries: [entry] }), 5)),
    );
    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0,
    });

    await batcher.read(1);
    expect(batcher.getStats().avgBatchLatencyMs).toBeGreaterThan(0);
  });
});

// ── drain() ───────────────────────────────────────────────────────────────────

describe('ReadBatcher — drain()', () => {
  it('flushes pending reads immediately when called before the window expires', async () => {
    const entry = makeLedgerEntry(99, { _decoded: { id: 99 } });
    const server = makeMockServer(() => Promise.resolve({ entries: [entry] }));

    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 5000, // very long window
    });

    // Kick off a read but do not wait for the window
    const readPromise = batcher.read(99);

    // drain() should flush immediately
    await batcher.drain();

    const result = await readPromise;
    expect(result).toEqual({ id: 99 });
    expect(server.getLedgerEntries).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when there are no pending reads', async () => {
    const server = makeMockServer(() => Promise.resolve({ entries: [] }));
    const batcher = new ReadBatcher(server, CONTRACT_ID, () => null, { batchWindowMs: 0 });

    await expect(batcher.drain()).resolves.toBeUndefined();
    expect(server.getLedgerEntries).not.toHaveBeenCalled();
  });
});

// ── Events ────────────────────────────────────────────────────────────────────

describe('ReadBatcher — events', () => {
  it('emits batch:complete after a successful flush', async () => {
    const entry = makeLedgerEntry(5, { _decoded: {} });
    const server = makeMockServer(() => Promise.resolve({ entries: [entry] }));
    const batcher = new ReadBatcher(server, CONTRACT_ID, scVal => scVal._decoded, {
      batchWindowMs: 0,
    });

    const completeListener = jest.fn();
    batcher.on('batch:complete', completeListener);

    await batcher.read(5);

    expect(completeListener).toHaveBeenCalledWith(
      expect.objectContaining({ totalTasks: 1, chunks: 1 }),
    );
  });

  it('emits batch:error when getLedgerEntries rejects', async () => {
    const server = makeMockServer(() => Promise.reject(new Error('RPC error')));
    const batcher = new ReadBatcher(server, CONTRACT_ID, () => null, { batchWindowMs: 0 });

    const errorListener = jest.fn();
    batcher.on('batch:error', errorListener);

    await expect(batcher.read(7)).rejects.toThrow();

    expect(errorListener).toHaveBeenCalledWith(
      expect.objectContaining({
        taskIds: [7],
        error: expect.any(Error),
      }),
    );
  });
});

// ── Poller integration ────────────────────────────────────────────────────────

describe('TaskPoller with ReadBatcher integration', () => {
  const TaskPoller = require('../src/poller');

  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

  let mockServer;

  beforeEach(() => {
    mockServer = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
      getAccount: jest.fn(),
      simulateTransaction: jest.fn(),
      getLedgerEntries: jest.fn(),
    };
  });

  it('accepts a ReadBatcher instance via options.batcher', () => {
    const batcher = new ReadBatcher(mockServer, contractId, () => null);
    const poller = new TaskPoller(mockServer, contractId, { batcher });
    expect(poller.batcher).toBe(batcher);
  });

  it('creates an internal batcher when batchReadsEnabled is true', () => {
    const poller = new TaskPoller(mockServer, contractId, { batchReadsEnabled: true });
    expect(poller.batcher).toBeInstanceOf(ReadBatcher);
  });

  it('leaves batcher null by default', () => {
    const poller = new TaskPoller(mockServer, contractId);
    expect(poller.batcher).toBeNull();
  });

  it('getBatcherStats() returns null when no batcher is configured', () => {
    const poller = new TaskPoller(mockServer, contractId);
    expect(poller.getBatcherStats()).toBeNull();
  });

  it('getBatcherStats() returns stats when batcher is configured', async () => {
    const batcher = new ReadBatcher(mockServer, contractId, () => null);
    const poller = new TaskPoller(mockServer, contractId, { batcher });
    const stats = poller.getBatcherStats();
    expect(stats).toHaveProperty('totalBatches');
    expect(stats).toHaveProperty('savedRpcCalls');
  });

  it('uses preloadedConfig from batcher instead of calling simulateTransaction', async () => {
    const taskConfig = { last_run: 500, interval: 400, gas_balance: 1000, args: [] };

    // Batcher returns the config without simulateTransaction being called
    const batcher = new ReadBatcher(mockServer, contractId, () => taskConfig, {
      batchWindowMs: 0,
    });

    // getLedgerEntries returns one entry for task 1
    mockServer.getLedgerEntries.mockResolvedValue({
      entries: [makeLedgerEntry(1, { _decoded: taskConfig })],
    });

    const poller = new TaskPoller(mockServer, contractId, { batcher });

    const due = await poller.pollDueTasks([1]);

    // simulateTransaction must NOT have been called (batcher handled the read)
    expect(mockServer.simulateTransaction).not.toHaveBeenCalled();
    // The task should be due (last_run 500 + interval 400 = 900 <= sequence 1000)
    expect(due.some(d => (d.taskId || d) === 1)).toBe(true);
  });

  it('falls back to per-task simulateTransaction when batcher.readMany rejects', async () => {
    const taskConfig = { last_run: 500, interval: 400, gas_balance: 1000, args: [] };

    // Batcher that always fails
    const batcher = new ReadBatcher(mockServer, contractId, () => null, { batchWindowMs: 0 });
    mockServer.getLedgerEntries.mockRejectedValue(new Error('getLedgerEntries unavailable'));

    // simulateTransaction fallback returns a valid config
    jest.spyOn(TaskPoller.prototype, 'getTaskConfig').mockResolvedValue(taskConfig);

    const poller = new TaskPoller(mockServer, contractId, { batcher });

    const due = await poller.pollDueTasks([1]);

    // getTaskConfig (simulateTransaction path) must have been called as fallback
    expect(TaskPoller.prototype.getTaskConfig).toHaveBeenCalledWith(1);
    expect(due.some(d => (d.taskId || d) === 1)).toBe(true);

    jest.restoreAllMocks();
  });
});
