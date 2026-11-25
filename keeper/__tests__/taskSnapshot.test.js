'use strict';

jest.mock('fs');
jest.mock('../src/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const fs = require('fs');
const crypto = require('crypto');
const TaskSnapshot = require('../src/taskSnapshot');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeV2Payload(overrides = {}) {
  const payload = {
    version: 2,
    savedAt: 1_700_000_000_000,
    lastSeenLedger: 5000,
    taskIds: [1, 2, 3],
    tasks: {
      '1': { id: 1, status: 'active', gas_balance: 500 },
      '2': { id: 2, status: 'paused', gas_balance: 200 },
      '3': { id: 3, status: 'registered', gas_balance: 0 },
    },
    ...overrides,
  };
  return payload;
}

function makeV2File(overrides = {}) {
  const payload = makeV2Payload(overrides);
  const body = JSON.stringify(payload, null, 2);
  const checksum = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  return JSON.stringify({ ...payload, checksum }, null, 2);
}

function makeV1File(lastSeenLedger = 3000) {
  const data = {
    version: 1,
    taskIds: [10, 20],
    tasks: {
      '10': { id: 10, status: 'active' },
      '20': { id: 20, status: 'paused' },
    },
    lastSeenLedger,
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
  return JSON.stringify(data, null, 2);
}

function makeSnapshot(options = {}) {
  return new TaskSnapshot({ dir: '/fake/dir', ...options });
}

function setupFsPromises() {
  fs.promises = {
    writeFile: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  fs.mkdirSync.mockReturnValue(undefined);
  fs.existsSync.mockReturnValue(false);
  fs.readFileSync.mockReturnValue(undefined);
  setupFsPromises();
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('constructor', () => {
  test('calls mkdirSync with recursive flag to ensure data directory', () => {
    makeSnapshot({ dir: '/custom/dir' });
    expect(fs.mkdirSync).toHaveBeenCalledWith('/custom/dir', { recursive: true });
  });

  test('applies default staleThresholdLedgers of 100 000', () => {
    const snap = makeSnapshot();
    expect(snap.staleThresholdLedgers).toBe(100_000);
  });

  test('respects custom staleThresholdLedgers', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 500 });
    expect(snap.staleThresholdLedgers).toBe(500);
  });

  test('defaults staleThresholdMs to 0 (wall-clock check disabled)', () => {
    const snap = makeSnapshot();
    expect(snap.staleThresholdMs).toBe(0);
  });

  test('respects custom staleThresholdMs', () => {
    const snap = makeSnapshot({ staleThresholdMs: 86_400_000 });
    expect(snap.staleThresholdMs).toBe(86_400_000);
  });

  test('initialises all stats to zero', () => {
    const snap = makeSnapshot();
    const stats = snap.getStats();
    expect(stats.saves).toBe(0);
    expect(stats.loads).toBe(0);
    expect(stats.checksumErrors).toBe(0);
    expect(stats.migrations).toBe(0);
  });
});

// ── save() ────────────────────────────────────────────────────────────────────

describe('save()', () => {
  test('writes to tmp file then renames to final path (atomic write)', async () => {
    const snap = makeSnapshot({ filename: 'tasks.json' });
    await snap.save({
      taskIds: new Set([1, 2]),
      tasks: new Map([[1, { id: 1 }], [2, { id: 2 }]]),
      lastSeenLedger: 9000,
    });

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      expect.any(String),
      'utf-8'
    );
    expect(fs.promises.rename).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      expect.not.stringContaining('.tmp')
    );
  });

  test('increments saves counter and records lastSaveMs on success', async () => {
    const snap = makeSnapshot();
    expect(snap.getStats().saves).toBe(0);

    await snap.save({
      taskIds: new Set([5]),
      tasks: new Map([[5, { id: 5 }]]),
      lastSeenLedger: 1000,
    });

    expect(snap.getStats().saves).toBe(1);
    expect(snap.getStats().lastSaveMs).toBeGreaterThan(0);
  });

  test('serialises taskIds sorted ascending', async () => {
    const snap = makeSnapshot();
    await snap.save({
      taskIds: new Set([30, 10, 20]),
      tasks: new Map(),
      lastSeenLedger: 0,
    });

    const written = fs.promises.writeFile.mock.calls[0][1];
    const parsed = JSON.parse(written);
    expect(parsed.taskIds).toEqual([10, 20, 30]);
  });

  test('embeds a 16-char hex checksum in the written payload', async () => {
    const snap = makeSnapshot();
    await snap.save({
      taskIds: new Set([1]),
      tasks: new Map([[1, { id: 1 }]]),
      lastSeenLedger: 100,
    });

    const written = fs.promises.writeFile.mock.calls[0][1];
    const parsed = JSON.parse(written);
    expect(parsed.checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  test('writes SNAPSHOT_VERSION 2', async () => {
    const snap = makeSnapshot();
    await snap.save({ taskIds: new Set(), tasks: new Map(), lastSeenLedger: 0 });

    const written = fs.promises.writeFile.mock.calls[0][1];
    expect(JSON.parse(written).version).toBe(2);
  });

  test('includes savedAt timestamp in the payload', async () => {
    const before = Date.now();
    const snap = makeSnapshot();
    await snap.save({ taskIds: new Set(), tasks: new Map(), lastSeenLedger: 0 });
    const after = Date.now();

    const written = fs.promises.writeFile.mock.calls[0][1];
    const { savedAt } = JSON.parse(written);
    expect(savedAt).toBeGreaterThanOrEqual(before);
    expect(savedAt).toBeLessThanOrEqual(after);
  });

  test('rethrows when writeFile rejects', async () => {
    fs.promises.writeFile.mockRejectedValue(new Error('disk full'));
    const snap = makeSnapshot();
    await expect(snap.save({ taskIds: new Set(), tasks: new Map(), lastSeenLedger: 0 }))
      .rejects.toThrow('disk full');
    expect(snap.getStats().saves).toBe(0);
  });

  test('rethrows when rename rejects', async () => {
    fs.promises.rename.mockRejectedValue(new Error('rename failed'));
    const snap = makeSnapshot();
    await expect(snap.save({ taskIds: new Set(), tasks: new Map(), lastSeenLedger: 0 }))
      .rejects.toThrow('rename failed');
    expect(snap.getStats().saves).toBe(0);
  });
});

// ── loadSync() ────────────────────────────────────────────────────────────────

describe('loadSync()', () => {
  test('returns null when file does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    const snap = makeSnapshot();
    expect(snap.loadSync()).toBeNull();
  });

  test('returns null on JSON parse error', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('not valid json{{{{');
    const snap = makeSnapshot();
    expect(snap.loadSync()).toBeNull();
  });

  test('returns null on unsupported version', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ version: 99, taskIds: [], tasks: {} }));
    const snap = makeSnapshot();
    expect(snap.loadSync()).toBeNull();
  });

  test('returns null and increments checksumErrors when checksum mismatches', () => {
    fs.existsSync.mockReturnValue(true);
    const payload = makeV2Payload();
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ ...payload, checksum: 'badbadbadbadbadb' }, null, 2)
    );
    const snap = makeSnapshot();
    expect(snap.loadSync()).toBeNull();
    expect(snap.getStats().checksumErrors).toBe(1);
  });

  test('successfully loads a valid v2 file with correct checksum', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeV2File());
    const snap = makeSnapshot();
    const data = snap.loadSync();
    expect(data).not.toBeNull();
    expect(data.version).toBe(2);
    expect(data.lastSeenLedger).toBe(5000);
    expect(data.taskIds).toEqual([1, 2, 3]);
  });

  test('increments loads counter on successful load', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeV2File());
    const snap = makeSnapshot();
    snap.loadSync();
    expect(snap.getStats().loads).toBe(1);
    expect(snap.getStats().lastLoadMs).toBeGreaterThan(0);
  });

  test('returns null when readFileSync throws', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => { throw new Error('permission denied'); });
    const snap = makeSnapshot();
    expect(snap.loadSync()).toBeNull();
  });
});

// ── v1 → v2 migration ────────────────────────────────────────────────────────

describe('v1 migration', () => {
  test('migrates v1 snapshot to version 2', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeV1File());
    const snap = makeSnapshot();
    const data = snap.loadSync();
    expect(data.version).toBe(2);
  });

  test('sets savedAt to null on migrated v1 snapshot (wall-clock check disabled)', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeV1File(4000));
    const snap = makeSnapshot();
    const data = snap.loadSync();
    expect(data.savedAt).toBeNull();
  });

  test('preserves taskIds and tasks from v1 snapshot', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeV1File(4000));
    const snap = makeSnapshot();
    const data = snap.loadSync();
    expect(data.taskIds).toEqual([10, 20]);
    expect(data.tasks['10'].id).toBe(10);
  });

  test('strips v1 updatedAt field from migrated result', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeV1File());
    const snap = makeSnapshot();
    const data = snap.loadSync();
    expect(data.updatedAt).toBeUndefined();
  });

  test('increments migrations counter', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeV1File());
    const snap = makeSnapshot();
    snap.loadSync();
    expect(snap.getStats().migrations).toBe(1);
  });

  test('trusts migrated v1 snapshot without checksum verification', () => {
    fs.existsSync.mockReturnValue(true);
    // v1 file has no checksum — should still load successfully
    const v1 = JSON.stringify({
      version: 1,
      taskIds: [7],
      tasks: { '7': { id: 7 } },
      lastSeenLedger: 2000,
    });
    fs.readFileSync.mockReturnValue(v1);
    const snap = makeSnapshot();
    const data = snap.loadSync();
    expect(data).not.toBeNull();
    expect(snap.getStats().checksumErrors).toBe(0);
  });
});

// ── isStale() ─────────────────────────────────────────────────────────────────

describe('isStale()', () => {
  test('not stale when ledger gap is within threshold', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 1000 });
    expect(snap.isStale({ lastSeenLedger: 4500, savedAt: null }, 5000)).toBe(false);
  });

  test('stale when ledger gap exceeds threshold', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 1000 });
    expect(snap.isStale({ lastSeenLedger: 3000, savedAt: null }, 5000)).toBe(true);
  });

  test('stale at exactly threshold + 1 ledgers', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 500 });
    expect(snap.isStale({ lastSeenLedger: 4499, savedAt: null }, 5000)).toBe(true);
  });

  test('not stale at exactly threshold ledgers', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 500 });
    expect(snap.isStale({ lastSeenLedger: 4500, savedAt: null }, 5000)).toBe(false);
  });

  test('wall-clock check skipped when staleThresholdMs is 0', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 100_000, staleThresholdMs: 0 });
    // savedAt is very old (epoch 0), but wall-clock check disabled
    expect(snap.isStale({ lastSeenLedger: 4900, savedAt: 0 }, 5000)).toBe(false);
  });

  test('wall-clock check skipped when savedAt is null (v1 migration)', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 100_000, staleThresholdMs: 3_600_000 });
    expect(snap.isStale({ lastSeenLedger: 4900, savedAt: null }, 5000)).toBe(false);
  });

  test('stale by wall-clock when savedAt is old and staleThresholdMs is set', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 100_000, staleThresholdMs: 3_600_000 });
    const twoHoursAgo = Date.now() - 7_200_000;
    expect(snap.isStale({ lastSeenLedger: 4900, savedAt: twoHoursAgo }, 5000)).toBe(true);
  });

  test('not stale by wall-clock when savedAt is recent', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 100_000, staleThresholdMs: 3_600_000 });
    const thirtyMinutesAgo = Date.now() - 1_800_000;
    expect(snap.isStale({ lastSeenLedger: 4900, savedAt: thirtyMinutesAgo }, 5000)).toBe(false);
  });

  test('stale by ledger even when wall-clock is recent', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 100, staleThresholdMs: 3_600_000 });
    const justNow = Date.now() - 1000;
    expect(snap.isStale({ lastSeenLedger: 4800, savedAt: justNow }, 5000)).toBe(true);
  });

  test('accepts custom nowMs for deterministic testing', () => {
    const snap = makeSnapshot({ staleThresholdLedgers: 100_000, staleThresholdMs: 3_600_000 });
    const fixedNow = 1_700_010_000_000;
    const savedAt = 1_700_010_000_000 - 7_200_000; // 2 hours ago relative to fixedNow
    expect(snap.isStale({ lastSeenLedger: 4900, savedAt }, 5000, fixedNow)).toBe(true);
  });
});

// ── getStats() ────────────────────────────────────────────────────────────────

describe('getStats()', () => {
  test('tracks saves and loads independently', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeV2File());

    const snap = makeSnapshot();
    snap.loadSync();
    snap.loadSync();
    await snap.save({ taskIds: new Set(), tasks: new Map(), lastSeenLedger: 0 });

    const stats = snap.getStats();
    expect(stats.loads).toBe(2);
    expect(stats.saves).toBe(1);
  });

  test('returns a plain object (not mutated by caller)', () => {
    const snap = makeSnapshot();
    const stats = snap.getStats();
    stats.saves = 999;
    expect(snap.getStats().saves).toBe(0); // original unaffected
  });
});

// ── Checksum round-trip ───────────────────────────────────────────────────────

describe('checksum round-trip', () => {
  test('checksum is self-consistent: save then load validates correctly', async () => {
    const snap = makeSnapshot();
    await snap.save({
      taskIds: new Set([1, 2, 3]),
      tasks: new Map([
        [1, { id: 1, status: 'active' }],
        [2, { id: 2, status: 'paused' }],
        [3, { id: 3, status: 'registered' }],
      ]),
      lastSeenLedger: 7500,
    });

    // Capture what was written to disk and feed it back to loadSync
    const writtenContent = fs.promises.writeFile.mock.calls[0][1];
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(writtenContent);

    const loaded = snap.loadSync();
    expect(loaded).not.toBeNull();
    expect(loaded.lastSeenLedger).toBe(7500);
    expect(loaded.taskIds).toEqual([1, 2, 3]);
    expect(snap.getStats().checksumErrors).toBe(0);
  });

  test('tampered payload fails checksum and is discarded', () => {
    // Construct valid v2 file, then tamper with lastSeenLedger
    const raw = makeV2File();
    const tampered = raw.replace('"lastSeenLedger": 5000', '"lastSeenLedger": 9999');

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(tampered);

    const snap = makeSnapshot();
    expect(snap.loadSync()).toBeNull();
    expect(snap.getStats().checksumErrors).toBe(1);
  });
});

// ── TaskRegistry integration ──────────────────────────────────────────────────

describe('TaskRegistry integration with injected snapshot', () => {
  const TaskRegistry = require('../src/registry');

  function mockServer(events = []) {
    return {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 2000 }),
      getEvents: jest.fn().mockResolvedValue({ events }),
    };
  }

  test('registry uses injected snapshot for loading on construction', () => {
    const mockSnap = {
      loadSync: jest.fn().mockReturnValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      isStale: jest.fn().mockReturnValue(false),
      getStats: jest.fn().mockReturnValue({}),
    };

    const registry = new TaskRegistry(mockServer(), 'CABC123', { snapshot: mockSnap });
    expect(mockSnap.loadSync).toHaveBeenCalled();
    expect(registry.taskIds.size).toBe(0);
  });

  test('registry populates from snapshot data on construction', () => {
    const mockSnap = {
      loadSync: jest.fn().mockReturnValue({
        version: 2,
        savedAt: Date.now(),
        lastSeenLedger: 1500,
        taskIds: [10, 20],
        tasks: {
          '10': { id: 10, status: 'active' },
          '20': { id: 20, status: 'paused' },
        },
      }),
      save: jest.fn().mockResolvedValue(undefined),
      isStale: jest.fn().mockReturnValue(false),
      getStats: jest.fn().mockReturnValue({}),
    };

    const registry = new TaskRegistry(mockServer(), 'CABC123', { snapshot: mockSnap });
    expect(registry.taskIds.has(10)).toBe(true);
    expect(registry.taskIds.has(20)).toBe(true);
    expect(registry.lastSeenLedger).toBe(1500);
  });

  test('registry clears state and resets ledger when snapshot is stale', async () => {
    const mockSnap = {
      loadSync: jest.fn().mockReturnValue({
        version: 2,
        savedAt: Date.now(),
        lastSeenLedger: 1500,
        taskIds: [10],
        tasks: { '10': { id: 10 } },
      }),
      save: jest.fn().mockResolvedValue(undefined),
      isStale: jest.fn().mockReturnValue(true), // force stale
      getStats: jest.fn().mockReturnValue({}),
    };

    const server = mockServer([]);
    const registry = new TaskRegistry(server, 'CABC123', { snapshot: mockSnap });
    await registry.init();

    expect(registry.taskIds.size).toBe(0);
    expect(registry.lastSeenLedger).toBe(1280); // 2000 - 720 (look-back window)
  });

  test('registry calls snapshot.save() after fetching events', async () => {
    const mockSnap = {
      loadSync: jest.fn().mockReturnValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      isStale: jest.fn().mockReturnValue(false),
      getStats: jest.fn().mockReturnValue({}),
    };

    const registry = new TaskRegistry(mockServer([]), 'CABC123', { snapshot: mockSnap });
    await registry.init();

    expect(mockSnap.save).toHaveBeenCalled();
    const saveArg = mockSnap.save.mock.calls[0][0];
    expect(saveArg).toHaveProperty('taskIds');
    expect(saveArg).toHaveProperty('tasks');
    expect(saveArg).toHaveProperty('lastSeenLedger');
  });

  test('registry tolerates snapshot.save() failure without throwing', async () => {
    const mockSnap = {
      loadSync: jest.fn().mockReturnValue(null),
      save: jest.fn().mockRejectedValue(new Error('disk full')),
      isStale: jest.fn().mockReturnValue(false),
      getStats: jest.fn().mockReturnValue({}),
    };

    const registry = new TaskRegistry(mockServer([]), 'CABC123', { snapshot: mockSnap });
    await expect(registry.init()).resolves.not.toThrow();
  });
});
