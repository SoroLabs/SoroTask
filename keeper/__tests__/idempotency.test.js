const fs = require("fs");
const os = require("os");
const path = require("path");
const { ExecutionIdempotencyGuard } = require("../src/idempotency");

describe("ExecutionIdempotencyGuard", () => {
  function createStateFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-idem-"));
    return path.join(dir, `${name}.json`);
  }

  it("should acquire a new lock with attempt identity", () => {
    const guard = new ExecutionIdempotencyGuard({
      stateFile: createStateFile("acquire"),
    });

    const result = guard.acquire(1);

    expect(result.acquired).toBe(true);
    expect(result.attemptId).toBeTruthy();
    expect(guard.getLock(1)).toBeTruthy();
  });

  it("should reuse existing lock identity while lock is active", () => {
    const guard = new ExecutionIdempotencyGuard({
      stateFile: createStateFile("reuse-active"),
      lockTtlMs: 30000,
    });

    const first = guard.acquire(9);
    const second = guard.acquire(9);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.attemptId).toBe(first.attemptId);
  });

  it("should recover from restart and clean stale locks", () => {
    const stateFile = createStateFile("restart-cleanup");

    const firstProcess = new ExecutionIdempotencyGuard({
      stateFile,
      lockTtlMs: 5,
    });

    const first = firstProcess.acquire(44);
    expect(first.acquired).toBe(true);

    const reloaded = new ExecutionIdempotencyGuard({
      stateFile,
      lockTtlMs: 5,
    });

    // Force cleanup with a future timestamp to simulate stale-lock recovery on restart.
    reloaded.cleanupExpired(Date.now() + 1000);

    const second = reloaded.acquire(44);
    expect(second.acquired).toBe(true);
    expect(second.attemptId).not.toBe(first.attemptId);
  });

  it("should persist retry and failure metadata for debugging", () => {
    const guard = new ExecutionIdempotencyGuard({
      stateFile: createStateFile("metadata"),
    });

    const acquired = guard.acquire(88);
    guard.touchRetry(88, { retries: 1, lastError: "NETWORK_ERROR" });
    guard.markFailed(88, { lastError: "TIMEOUT_ERROR" });

    const lock = guard.getLock(88);
    expect(lock.attemptId).toBe(acquired.attemptId);
    expect(lock.retries).toBe(1);
    expect(lock.lastError).toBe("TIMEOUT_ERROR");
    expect(lock.status).toBe("failed");
  });
});
