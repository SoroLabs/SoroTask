'use strict';
/**
 * index.ceremony.test.js
 *
 * Focused tests for the Powers-of-Tau / zkey trusted setup ceremony
 * verification gate introduced in ZK-SERVICE issue #792.
 *
 * Tests cover:
 *  - computeFileSha256: streams a real temp file and returns the correct digest
 *  - auditZkeyChecksums: rejects missing files, rejects checksum mismatches,
 *    accepts correct checksums, handles empty entry lists
 *  - ZKProofService.initialize(): aborts (throws) when a zkey audit fails,
 *    proceeds normally when no audit entries are provided,
 *    proceeds normally when all audit entries pass
 *  - Backward compatibility: existing callers that pass no zkeyAuditEntries
 *    are unaffected — initialize() still works synchronously-compatible
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');

const { ZKProofService, auditZkeyChecksums, computeFileSha256 } = require('./index');

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Write `content` (Buffer or string) to a unique temp file and return its path.
 * Cleaned up in afterEach.
 */
const tempFiles = [];
function writeTempFile(content) {
  const p = path.join(os.tmpdir(), `zkey-test-${crypto.randomBytes(8).toString('hex')}.bin`);
  fs.writeFileSync(p, content);
  tempFiles.push(p);
  return p;
}

afterEach(() => {
  for (const f of tempFiles.splice(0)) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

// ─── computeFileSha256 ────────────────────────────────────────────────────────

describe('computeFileSha256', () => {
  test('returns the correct SHA-256 hex digest for a known file', async () => {
    const content = Buffer.from('Powers of Tau phase 1 artifact');
    const expected = crypto.createHash('sha256').update(content).digest('hex');
    const filePath = writeTempFile(content);

    const actual = await computeFileSha256(filePath);
    expect(actual).toBe(expected);
  });

  test('returns a 64-character lowercase hex string', async () => {
    const filePath = writeTempFile('any content');
    const digest = await computeFileSha256(filePath);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('rejects when the file does not exist', async () => {
    await expect(computeFileSha256('/nonexistent/path/artifact.zkey')).rejects.toThrow();
  });

  test('handles an empty file (SHA-256 of empty bytes)', async () => {
    const expected = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    const filePath = writeTempFile(Buffer.alloc(0));
    const actual = await computeFileSha256(filePath);
    expect(actual).toBe(expected);
  });

  test('produces different digests for different contents', async () => {
    const file1 = writeTempFile('content-one');
    const file2 = writeTempFile('content-two');
    const digest1 = await computeFileSha256(file1);
    const digest2 = await computeFileSha256(file2);
    expect(digest1).not.toBe(digest2);
  });
});

// ─── auditZkeyChecksums ───────────────────────────────────────────────────────

describe('auditZkeyChecksums', () => {
  test('resolves successfully when the entry list is empty', async () => {
    await expect(auditZkeyChecksums([])).resolves.toBeUndefined();
  });

  test('resolves when a single file matches its expected checksum', async () => {
    const content = Buffer.from('pot18_final.ptau mock contents');
    const expected = crypto.createHash('sha256').update(content).digest('hex');
    const file = writeTempFile(content);

    await expect(auditZkeyChecksums([{ file, expectedSha256: expected }])).resolves.toBeUndefined();
  });

  test('resolves when multiple files all match their expected checksums', async () => {
    const entries = ['ptau', 'zkey', 'vkey'].map((label) => {
      const content = Buffer.from(`${label} artifact data`);
      return {
        file: writeTempFile(content),
        expectedSha256: crypto.createHash('sha256').update(content).digest('hex'),
      };
    });

    await expect(auditZkeyChecksums(entries)).resolves.toBeUndefined();
  });

  test('throws when a file does not exist', async () => {
    await expect(
      auditZkeyChecksums([{ file: '/no/such/file.zkey', expectedSha256: 'a'.repeat(64) }]),
    ).rejects.toThrow(/Setup file not found/);
  });

  test('error message for missing file includes the file path', async () => {
    const missingPath = '/no/such/artifact.ptau';
    await expect(
      auditZkeyChecksums([{ file: missingPath, expectedSha256: 'a'.repeat(64) }]),
    ).rejects.toThrow(missingPath);
  });

  test('throws when actual checksum does not match expected (tampered file)', async () => {
    const content = Buffer.from('real ceremony artifact');
    const file = writeTempFile(content);
    const wrongChecksum = 'deadbeef'.repeat(8); // 64 hex chars, wrong value

    await expect(
      auditZkeyChecksums([{ file, expectedSha256: wrongChecksum }]),
    ).rejects.toThrow(/Checksum mismatch/);
  });

  test('error message for checksum mismatch includes expected and actual values', async () => {
    const content = Buffer.from('tampered zkey');
    const file = writeTempFile(content);
    const actualDigest = crypto.createHash('sha256').update(content).digest('hex');
    const wrongChecksum = 'f'.repeat(64);

    let caughtMessage = '';
    try {
      await auditZkeyChecksums([{ file, expectedSha256: wrongChecksum }]);
    } catch (err) {
      caughtMessage = err.message;
    }

    expect(caughtMessage).toContain(wrongChecksum);
    expect(caughtMessage).toContain(actualDigest);
  });

  test('checksum comparison is case-insensitive (upper vs lower hex)', async () => {
    const content = Buffer.from('case insensitive test');
    const file = writeTempFile(content);
    const digest = crypto.createHash('sha256').update(content).digest('hex');

    // Pass the expected checksum in UPPERCASE
    await expect(
      auditZkeyChecksums([{ file, expectedSha256: digest.toUpperCase() }]),
    ).resolves.toBeUndefined();
  });

  test('fails on the first bad entry and does not continue (fail-fast)', async () => {
    const goodContent = Buffer.from('good file');
    const goodFile = writeTempFile(goodContent);
    const goodSha = crypto.createHash('sha256').update(goodContent).digest('hex');

    // First entry: missing file
    const entries = [
      { file: '/nonexistent/first.zkey', expectedSha256: 'a'.repeat(64) },
      { file: goodFile, expectedSha256: goodSha },
    ];

    await expect(auditZkeyChecksums(entries)).rejects.toThrow(/Setup file not found/);
  });

  test('state is unchanged after a failed audit (pure function — no side effects)', async () => {
    const content = Buffer.from('original');
    const file = writeTempFile(content);
    const correctSha = crypto.createHash('sha256').update(content).digest('hex');

    // Run with wrong checksum
    try {
      await auditZkeyChecksums([{ file, expectedSha256: 'bad'.padEnd(64, '0') }]);
    } catch { /* expected */ }

    // File and its correct checksum are still intact
    await expect(
      auditZkeyChecksums([{ file, expectedSha256: correctSha }]),
    ).resolves.toBeUndefined();
  });
});

// ─── ZKProofService.initialize() — ceremony gate ─────────────────────────────

describe('ZKProofService.initialize() — ceremony gate', () => {
  let service;

  afterEach(() => {
    if (service) {
      service.shutdown();
      service = null;
    }
  });

  test('initialize() aborts and throws when a zkey file is missing', async () => {
    service = new ZKProofService(1, {
      zkeyAuditEntries: [
        { file: '/nonexistent/pot18_final.ptau', expectedSha256: 'a'.repeat(64) },
      ],
    });

    await expect(service.initialize()).rejects.toThrow(/Setup file not found/);

    // Service must NOT be marked ready after a failed audit
    expect(service.isReady).toBe(false);
  });

  test('initialize() aborts when checksum does not match (tampered artifact)', async () => {
    const content = Buffer.from('tampered ptau');
    const file = writeTempFile(content);

    service = new ZKProofService(1, {
      zkeyAuditEntries: [{ file, expectedSha256: 'deadbeef'.repeat(8) }],
    });

    await expect(service.initialize()).rejects.toThrow(/Checksum mismatch/);
    expect(service.isReady).toBe(false);
  });

  test('initialize() completes successfully when all artifacts pass verification', async () => {
    const ptauContent = Buffer.from('pot18_final.ptau contents');
    const zkeyContent = Buffer.from('circuit_final.zkey contents');
    const ptauFile = writeTempFile(ptauContent);
    const zkeyFile = writeTempFile(zkeyContent);

    service = new ZKProofService(1, {
      zkeyAuditEntries: [
        {
          file: ptauFile,
          expectedSha256: crypto.createHash('sha256').update(ptauContent).digest('hex'),
        },
        {
          file: zkeyFile,
          expectedSha256: crypto.createHash('sha256').update(zkeyContent).digest('hex'),
        },
      ],
    });

    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.isReady).toBe(true);
  });

  test('initialize() works normally when no zkeyAuditEntries are provided (backward compat)', async () => {
    service = new ZKProofService(1); // no options.zkeyAuditEntries
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.isReady).toBe(true);
  });

  test('initialize() works when zkeyAuditEntries is an empty array', async () => {
    service = new ZKProofService(1, { zkeyAuditEntries: [] });
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.isReady).toBe(true);
  });

  test('workers are NOT spawned when the ceremony gate fails', async () => {
    service = new ZKProofService(2, {
      zkeyAuditEntries: [
        { file: '/missing/zkey.bin', expectedSha256: 'a'.repeat(64) },
      ],
    });

    try { await service.initialize(); } catch { /* expected */ }

    // Worker pool must remain empty — no workers spawned before audit passes
    expect(service.workers.length).toBe(0);
  });

  test('workers ARE spawned after a successful ceremony gate', async () => {
    const content = Buffer.from('valid artifact');
    const file = writeTempFile(content);

    service = new ZKProofService(2, {
      zkeyAuditEntries: [
        {
          file,
          expectedSha256: crypto.createHash('sha256').update(content).digest('hex'),
        },
      ],
    });

    await service.initialize();
    expect(service.workers.length).toBe(2);
  });

  test('initialize() returns a Promise (is async)', () => {
    service = new ZKProofService(1);
    const result = service.initialize();
    expect(result).toBeInstanceOf(Promise);
    return result; // let Jest await
  });
});

// ─── Backward compatibility: existing code calling initialize() ───────────────

describe('Backward compatibility', () => {
  test('ZKProofService can be constructed without zkeyAuditEntries and fully used', async () => {
    const svc = new ZKProofService(2);
    await svc.initialize();

    expect(svc.isReady).toBe(true);
    expect(svc.workers.length).toBe(2);
    expect(svc.getWorkerPoolStatus()).toEqual({
      totalWorkers: 2,
      idleWorkers: 2,
      activeWorkers: 0,
    });

    svc.shutdown();
  });

  test('proof generation still works after initialize() with no audit entries', async () => {
    const svc = new ZKProofService(1);
    await svc.initialize();

    const proof = await svc.generateProof(
      { type: 'test', params: {} },
      { witness: { value: 42 } },
    );

    expect(proof).toHaveProperty('proofId');
    expect(proof.status).toBe('success');

    svc.shutdown();
  });
});
