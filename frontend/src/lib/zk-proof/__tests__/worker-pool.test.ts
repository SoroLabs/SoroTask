import { WorkerPool } from "../worker-pool";

describe("WorkerPool", () => {
  let pool: WorkerPool;
  let scheduled: Array<{ fn: () => void; ms: number }>;

  function drainScheduled() {
    while (scheduled.length > 0) {
      scheduled.shift()!.fn();
    }
  }

  beforeEach(() => {
    scheduled = [];
    pool = new WorkerPool({
      workerCount: 2,
      baseDelayMs: 0,
      maxRetries: 2,
      congestionMultiplier: 1,
      now: () => 1000,
      schedule: (fn, ms) => {
        scheduled.push({ fn, ms });
      },
    });
  });

  afterEach(() => {
    pool.shutdown();
  });

  it("initializes with correct worker count", () => {
    expect(pool.getTotalWorkerCount()).toBe(2);
    expect(pool.getIdleWorkerCount()).toBe(2);
    expect(pool.getBusyWorkerCount()).toBe(0);
  });

  it("returns available worker", () => {
    const worker = pool.getAvailableWorker();
    expect(worker).not.toBeNull();
    expect(worker!.status).toBe("idle");
  });

  it("executes proof computation successfully", async () => {
    const promise = pool.execute(
      '{"minLiquidity": 10000}',
      '{"actualLiquidity": 25000}',
      false,
      false,
    );
    drainScheduled();
    const proof = await promise;

    expect(proof.status).toBe("success");
    expect(proof.proofId).toBeDefined();
    expect(proof.pi_a).toHaveLength(2);
    expect(proof.pi_b).toHaveLength(2);
    expect(proof.pi_c).toHaveLength(2);
    expect(proof.publicSignals).toHaveLength(1);
  });

  it("executes proof computation with congestion", async () => {
    const promise = pool.execute(
      '{"minLiquidity": 10000}',
      '{"actualLiquidity": 25000}',
      false,
      true,
    );
    drainScheduled();
    const proof = await promise;

    expect(proof.status).toBe("success");
  });

  it("rejects when simulation failure is enabled", async () => {
    const promise = pool.execute("{}", "{}", true, false);
    drainScheduled();

    await expect(promise).rejects.toThrow("Constraint validation mismatch");
  });

  it("calls onStage callbacks during execution", async () => {
    const stages: string[] = [];
    const promise = pool.execute("{}", "{}", false, false, (stage) => {
      stages.push(stage);
    });
    drainScheduled();
    await promise;

    expect(stages.length).toBeGreaterThanOrEqual(3);
    expect(stages).toContain("allocating_worker");
    expect(stages).toContain("ingesting_data");
    expect(stages).toContain("building_constraints");
  });

  it("marks worker as busy then idle after execution", async () => {
    expect(pool.getBusyWorkerCount()).toBe(0);
    const promise = pool.execute("{}", "{}", false, false);
    expect(pool.getBusyWorkerCount()).toBe(1);
    drainScheduled();
    await promise;
    expect(pool.getBusyWorkerCount()).toBe(0);
  });

  it("shuts down correctly", () => {
    pool.shutdown();
    expect(pool.getTotalWorkerCount()).toBe(0);
    expect(pool.getIdleWorkerCount()).toBe(0);
  });

  it("handles multiple concurrent executions", async () => {
    const p1 = pool.execute("{}", "{}", false, false);
    const p2 = pool.execute("{}", "{}", false, false);
    drainScheduled();

    const results = await Promise.all([p1, p2]);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("success");
    expect(results[1].status).toBe("success");
  });

  it("generates unique proof IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = (pool as any).generateProofId();
      ids.add(id);
    }
    expect(ids.size).toBe(100);
  });

  it("works with default setTimeout when no schedule provided", async () => {
    const defaultPool = new WorkerPool({
      workerCount: 1,
      baseDelayMs: 0,
      maxRetries: 1,
      congestionMultiplier: 1,
    });
    const proof = await defaultPool.execute("{}", "{}", false, false);
    expect(proof.status).toBe("success");
    defaultPool.shutdown();
  });

  it("initializes with zero workers correctly", () => {
    const emptyPool = new WorkerPool({
      workerCount: 0,
      baseDelayMs: 100,
      maxRetries: 2,
      congestionMultiplier: 3,
      now: () => 1000,
      schedule: (fn, ms) => {
        scheduled.push({ fn, ms });
      },
    });
    expect(emptyPool.getTotalWorkerCount()).toBe(0);
    emptyPool.shutdown();
  });

  it("uses default crypto.randomUUID for proof IDs when available", () => {
    const cryptoBackup = global.crypto;
    const mockRandomUUID = jest.fn().mockReturnValue("mock-uuid-12345");
    Object.defineProperty(global, "crypto", {
      value: { randomUUID: mockRandomUUID },
      writable: true,
    });

    const id = (pool as any).generateProofId();
    expect(id).toBe("mock-uuid-12345");

    Object.defineProperty(global, "crypto", {
      value: cryptoBackup,
      writable: true,
    });
  });

  it("queues tasks when no worker is available", async () => {
    // Use real setTimeout(0) to avoid microtask ordering issues
    const singleWorkerPool = new WorkerPool({
      workerCount: 1,
      baseDelayMs: 0,
      maxRetries: 2,
      congestionMultiplier: 1,
      now: () => 1000,
    });

    // First call occupies the only worker
    const p1 = singleWorkerPool.execute("{}", "{}", false, false);
    // Second call will be queued
    const p2 = singleWorkerPool.execute("{}", "{}", false, false);

    // With delay=0 and real setTimeout, both should resolve in the next tick
    await new Promise((resolve) => setTimeout(resolve, 10));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe("success");
    expect(r2.status).toBe("success");

    singleWorkerPool.shutdown();
  });
});
