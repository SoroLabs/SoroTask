'use strict';
/**
 * ceremonyCoordinator.test.js
 *
 * Hardening tests for [BE-FINAL-24] Zero-Knowledge Trusted Setup Ceremony
 * Coordinator & ZKey Integrity Checksum Validator.
 *
 * Coverage:
 *   Unit        — checksum primitive, error type, registry loading/validation,
 *                 artifact discovery, single-key verification.
 *   Integration — ZKProofService.initialize() ceremony gate (valid, tampered,
 *                 missing, unregistered), cryptographic verification logging.
 *   Stress      — large artifact sets (hundreds of keys), large single artifact,
 *                 concurrent single-flight audit.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  CeremonyCoordinator,
  ZKeyIntegrityError,
  computeFileSha256,
  auditZkeyChecksums,
} = require('./ceremonyCoordinator');
const { ZKProofService } = require('../index');

// ─── helpers ──────────────────────────────────────────────────────────────────

const tempDirs = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceremony-test-'));
  tempDirs.push(dir);
  return dir;
}

/** Write `content` to `<dir>/<relPath>` (creating parents) and return details. */
function writeArtifact(dir, relPath, content) {
  const file = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return { file, relPath, sha256: crypto.createHash('sha256').update(content).digest('hex') };
}

/** Logger stub that records everything for assertions. */
function makeMockLogger() {
  const messages = [];
  return {
    messages,
    info: (msg) => messages.push({ level: 'info', msg }),
    warn: (msg) => messages.push({ level: 'warn', msg }),
    error: (msg) => messages.push({ level: 'error', msg }),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// ─── Unit: checksum primitive ────────────────────────────────────────────────

describe('computeFileSha256', () => {
  test('streams a file and returns the correct 64-char hex digest', async () => {
    const dir = makeTempDir();
    const content = Buffer.from('Groth16 proving key bytes');
    const expected = crypto.createHash('sha256').update(content).digest('hex');
    const { file } = writeArtifact(dir, 'circuit_final.zkey', content);

    await expect(computeFileSha256(file)).resolves.toBe(expected);
  });

  test('rejects when the file does not exist', async () => {
    await expect(computeFileSha256('/no/such/artifact.zkey')).rejects.toThrow();
  });
});

// ─── Unit: error type ────────────────────────────────────────────────────────

describe('ZKeyIntegrityError', () => {
  test('is an Error with a stable name, code, and propagated details', () => {
    const err = new ZKeyIntegrityError('boom', { reason: 'mismatch', file: 'a.zkey' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ZKeyIntegrityError');
    expect(err.code).toBe('ZKEY_INTEGRITY_FAILURE');
    expect(err.reason).toBe('mismatch');
    expect(err.file).toBe('a.zkey');
  });
});

// ─── Unit: legacy auditZkeyChecksums re-export keeps working ─────────────────

describe('auditZkeyChecksums (re-exported)', () => {
  test('accepts a matching artifact and rejects a tampered one', async () => {
    const dir = makeTempDir();
    const { file, sha256 } = writeArtifact(dir, 'ptau.ptau', 'ceremony transcript');
    await expect(auditZkeyChecksums([{ file, expectedSha256: sha256 }])).resolves.toBeUndefined();
    await expect(
      auditZkeyChecksums([{ file, expectedSha256: 'a'.repeat(64) }]),
    ).rejects.toThrow(/Checksum mismatch/);
  });
});

// ─── Unit: registry loading & immutability ───────────────────────────────────

describe('CeremonyCoordinator — registry', () => {
  test('loads a static registry and freezes it (immutable)', async () => {
    const dir = makeTempDir();
    const coordinator = new CeremonyCoordinator({
      circuitsDir: dir,
      registry: { 'range.zkey': 'A'.repeat(64) },
      logger: makeMockLogger(),
    });

    const registry = await coordinator.loadRegistry();
    expect(Object.isFrozen(registry)).toBe(true);
    expect(registry['range.zkey']).toBe('a'.repeat(64)); // normalised to lowercase
    expect(coordinator.getRegistry()).toBe(registry);
  });

  test('normalises Windows-style relative keys to forward slashes', async () => {
    const coordinator = new CeremonyCoordinator({
      circuitsDir: makeTempDir(),
      registry: { 'nested\\deep.zkey': 'b'.repeat(64) },
      logger: makeMockLogger(),
    });

    const registry = await coordinator.loadRegistry();
    expect(registry['nested/deep.zkey']).toBe('b'.repeat(64));
  });

  test('loads from an async on-chain registry provider', async () => {
    const provider = jest.fn(async () => new Map([['a.zkey', 'c'.repeat(64)]]));
    const coordinator = new CeremonyCoordinator({
      circuitsDir: makeTempDir(),
      registryProvider: provider,
      logger: makeMockLogger(),
    });

    const registry = await coordinator.loadRegistry();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(registry['a.zkey']).toBe('c'.repeat(64));
  });

  test('single-flight: concurrent loads invoke the provider exactly once', async () => {
    const provider = jest.fn(async () => ({ 'a.zkey': 'd'.repeat(64) }));
    const coordinator = new CeremonyCoordinator({
      circuitsDir: makeTempDir(),
      registryProvider: provider,
      logger: makeMockLogger(),
    });

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => coordinator.loadRegistry()));
    expect(provider).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toBe(results[0]);
  });

  test('throws ZKeyIntegrityError when no registry is configured (fail-closed)', async () => {
    const coordinator = new CeremonyCoordinator({ circuitsDir: makeTempDir(), logger: makeMockLogger() });
    await expect(coordinator.loadRegistry()).rejects.toBeInstanceOf(ZKeyIntegrityError);
  });

  test('rejects a malformed registry entry', async () => {
    const coordinator = new CeremonyCoordinator({
      circuitsDir: makeTempDir(),
      registry: { 'bad.zkey': 'not-a-digest' },
      logger: makeMockLogger(),
    });
    await expect(coordinator.loadRegistry()).rejects.toThrow(/Invalid registry entry/);
  });
});

// ─── Unit: discovery ─────────────────────────────────────────────────────────

describe('CeremonyCoordinator — discovery', () => {
  test('finds .zkey files recursively, ignores other artifacts, sorted', () => {
    const dir = makeTempDir();
    writeArtifact(dir, 'b.zkey', 'b');
    writeArtifact(dir, 'nested/a.zkey', 'a');
    writeArtifact(dir, 'circuit.wasm', 'wasm');
    writeArtifact(dir, 'pot18.ptau', 'ptau');
    writeArtifact(dir, 'notes.txt', 'nope');

    const coordinator = new CeremonyCoordinator({ circuitsDir: dir, logger: makeMockLogger() });
    const keys = coordinator.discoverProvingKeys();
    const rel = keys.map((f) => path.relative(dir, f).replace(/\\/g, '/'));

    expect(rel).toEqual(['b.zkey', 'nested/a.zkey']);
  });

  test('returns an empty list for a missing directory', () => {
    const coordinator = new CeremonyCoordinator({
      circuitsDir: path.join(os.tmpdir(), 'definitely-missing-dir-xyz'),
      logger: makeMockLogger(),
    });
    expect(coordinator.discoverProvingKeys()).toEqual([]);
  });
});

// ─── Unit: single-key verification ───────────────────────────────────────────

describe('CeremonyCoordinator — verifyProvingKey', () => {
  test('returns the digest and emits a cryptographic verification log', async () => {
    const dir = makeTempDir();
    const logger = makeMockLogger();
    const { file, sha256 } = writeArtifact(dir, 'membership.zkey', 'valid key');
    const coordinator = new CeremonyCoordinator({ circuitsDir: dir, logger });

    const result = await coordinator.verifyProvingKey(file, sha256);
    expect(result.sha256).toBe(sha256);

    const logged = logger.messages.map((m) => m.msg).join('\n');
    expect(logged).toContain('SHA-256');
    expect(logged).toContain(sha256);
  });

  test('throws ZKeyIntegrityError (reason=mismatch) on a tampered key', async () => {
    const dir = makeTempDir();
    const { file, sha256 } = writeArtifact(dir, 'tampered.zkey', 'original');
    fs.writeFileSync(file, 'modified!'); // tamper after hashing

    const coordinator = new CeremonyCoordinator({ circuitsDir: dir, logger: makeMockLogger() });
    let caught;
    try {
      await coordinator.verifyProvingKey(file, sha256);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZKeyIntegrityError);
    expect(caught.reason).toBe('mismatch');
    expect(caught.expected).toBe(sha256);
    expect(caught.actual).not.toBe(sha256);
  });

  test('throws ZKeyIntegrityError (reason=missing) when the key is absent', async () => {
    const coordinator = new CeremonyCoordinator({ circuitsDir: makeTempDir(), logger: makeMockLogger() });
    let caught;
    try {
      await coordinator.verifyProvingKey('/no/such/key.zkey', 'e'.repeat(64));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZKeyIntegrityError);
    expect(caught.reason).toBe('missing');
  });
});

// ─── Unit: startup audit ─────────────────────────────────────────────────────

describe('CeremonyCoordinator — auditAtStartup', () => {
  test('passes and records the audit when every key matches', async () => {
    const dir = makeTempDir();
    const a = writeArtifact(dir, 'a.zkey', 'key-a');
    const b = writeArtifact(dir, 'nested/b.zkey', 'key-b');
    const coordinator = new CeremonyCoordinator({
      circuitsDir: dir,
      registry: { 'a.zkey': a.sha256, 'nested/b.zkey': b.sha256 },
      logger: makeMockLogger(),
    });

    const summary = await coordinator.auditAtStartup();
    expect(summary.ok).toBe(true);
    expect(summary.verifiedCount).toBe(2);
    expect(coordinator.getLastAudit()).toEqual(summary);
  });

  test('rejects a tampered proving key', async () => {
    const dir = makeTempDir();
    const { file, relPath, sha256 } = writeArtifact(dir, 'x.zkey', 'good');
    fs.writeFileSync(file, 'evil');

    const coordinator = new CeremonyCoordinator({
      circuitsDir: dir,
      registry: { [relPath]: sha256 },
      logger: makeMockLogger(),
    });
    await expect(coordinator.auditAtStartup()).rejects.toThrow(/Checksum mismatch/);
    expect(coordinator.getLastAudit()).toBeNull();
  });

  test('rejects when a registered key is missing from disk', async () => {
    const dir = makeTempDir();
    const coordinator = new CeremonyCoordinator({
      circuitsDir: dir,
      registry: { 'gone.zkey': 'f'.repeat(64) },
      logger: makeMockLogger(),
    });
    await expect(coordinator.auditAtStartup()).rejects.toThrow(/not found/);
  });

  test('fail-closed: rejects an unregistered proving key present on disk', async () => {
    const dir = makeTempDir();
    const known = writeArtifact(dir, 'known.zkey', 'known');
    writeArtifact(dir, 'rogue.zkey', 'rogue');

    const coordinator = new CeremonyCoordinator({
      circuitsDir: dir,
      registry: { 'known.zkey': known.sha256 },
      logger: makeMockLogger(),
    });
    await expect(coordinator.auditAtStartup()).rejects.toThrow(/Unregistered proving key/);
  });

  test('empty registry with no keys on disk is a valid, empty audit', async () => {
    const coordinator = new CeremonyCoordinator({
      circuitsDir: makeTempDir(),
      registry: {},
      logger: makeMockLogger(),
    });
    const summary = await coordinator.auditAtStartup();
    expect(summary.verifiedCount).toBe(0);
  });
});

// ─── Integration: ZKProofService.initialize() ceremony gate ───────────────────

describe('Integration — ZKProofService ceremony gate', () => {
  let service;

  afterEach(() => {
    if (service) { service.shutdown(); service = null; }
  });

  function coordinatorFor(dir, registry, logger) {
    return new CeremonyCoordinator({ circuitsDir: dir, registry, logger });
  }

  test('initialize() succeeds and spawns workers when all keys verify', async () => {
    const dir = makeTempDir();
    const { relPath, sha256 } = writeArtifact(dir, 'circuit.zkey', 'sound proving key');
    const logger = makeMockLogger();

    service = new ZKProofService(2, {
      ceremonyCoordinator: coordinatorFor(dir, { [relPath]: sha256 }, logger),
    });

    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.isReady).toBe(true);
    expect(service.workers.length).toBe(2);

    // Cryptographic verification logs were emitted.
    const logged = logger.messages.map((m) => m.msg).join('\n');
    expect(logged).toContain('SHA-256');
    expect(logged).toContain(sha256);
  });

  test('initialize() aborts (throws) and spawns no workers on a tampered .zkey', async () => {
    const dir = makeTempDir();
    const { file, relPath, sha256 } = writeArtifact(dir, 'circuit.zkey', 'sound');
    fs.writeFileSync(file, 'TAMPERED');

    service = new ZKProofService(2, {
      ceremonyCoordinator: coordinatorFor(dir, { [relPath]: sha256 }, makeMockLogger()),
    });

    await expect(service.initialize()).rejects.toBeInstanceOf(ZKeyIntegrityError);
    expect(service.isReady).toBe(false);
    expect(service.workers.length).toBe(0);
  });

  test('initialize() aborts when the coordinator has no registry configured', async () => {
    const dir = makeTempDir();
    const coordinator = new CeremonyCoordinator({ circuitsDir: dir, logger: makeMockLogger() });
    service = new ZKProofService(1, { ceremonyCoordinator: coordinator });

    await expect(service.initialize()).rejects.toBeInstanceOf(ZKeyIntegrityError);
    expect(service.isReady).toBe(false);
  });

  test('initialize() is unaffected when no coordinator is supplied (backward compat)', async () => {
    service = new ZKProofService(1);
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.isReady).toBe(true);
  });
});

// ─── Stress ──────────────────────────────────────────────────────────────────

describe('Stress — ceremony coordinator', () => {
  test('audits a large proving-key set (300 keys)', async () => {
    const dir = makeTempDir();
    const registry = {};
    for (let i = 0; i < 300; i += 1) {
      const { relPath, sha256 } = writeArtifact(dir, `circuit-${i}.zkey`, `proving-key-${i}`);
      registry[relPath] = sha256;
    }

    const coordinator = new CeremonyCoordinator({ circuitsDir: dir, registry, logger: makeMockLogger() });
    const summary = await coordinator.auditAtStartup();

    expect(summary.ok).toBe(true);
    expect(summary.verifiedCount).toBe(300);
    expect(summary.verified).toHaveLength(300);
  });

  test('verifies a large single artifact without buffering errors', async () => {
    const dir = makeTempDir();
    const big = crypto.randomBytes(8 * 1024 * 1024); // 8 MiB
    const { file, sha256 } = writeArtifact(dir, 'big.zkey', big);
    const coordinator = new CeremonyCoordinator({ circuitsDir: dir, logger: makeMockLogger() });

    const result = await coordinator.verifyProvingKey(file, sha256);
    expect(result.sha256).toBe(sha256);
  });

  test('concurrent startup audits are single-flight and consistent', async () => {
    const dir = makeTempDir();
    const registry = {};
    for (let i = 0; i < 20; i += 1) {
      const { relPath, sha256 } = writeArtifact(dir, `k${i}.zkey`, `k${i}`);
      registry[relPath] = sha256;
    }

    const provider = jest.fn(async () => registry);
    const coordinator = new CeremonyCoordinator({
      circuitsDir: dir,
      registryProvider: provider,
      logger: makeMockLogger(),
    });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => coordinator.auditAtStartup()),
    );

    expect(provider).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toBe(results[0]);
    expect(results[0].verifiedCount).toBe(20);
  });
});
