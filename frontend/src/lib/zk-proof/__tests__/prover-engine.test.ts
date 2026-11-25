import { ProverEngine } from "../prover-engine";
import type { ZkTask, ZkProofGenerationOptions } from "../types";

function createScheduler(): {
  scheduled: Array<{ fn: () => void; ms: number }>;
  schedule: (fn: () => void, ms: number) => void;
  drain: () => void;
} {
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  return {
    scheduled,
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
    },
    drain: () => {
      while (scheduled.length > 0) {
        const { fn } = scheduled.shift()!;
        fn();
      }
    },
  };
}

describe("ProverEngine", () => {
  let engine: ProverEngine;
  let tasks: ZkTask[];
  let scheduler: ReturnType<typeof createScheduler>;

  beforeEach(() => {
    scheduler = createScheduler();
    engine = new ProverEngine({
      config: {
        workerCount: 2,
        maxRetries: 2,
        baseDelayMs: 0,
        congestionMultiplier: 1,
        now: () => 1000,
        schedule: scheduler.schedule,
      },
    });
    tasks = [
      {
        id: 1,
        contractAddress: "CAFE1234",
        functionName: "harvest_yield",
        interval: 3600,
        gasBalance: 10,
        status: "active",
      },
      {
        id: 2,
        contractAddress: "BEEF5678",
        functionName: "claim_yield",
        interval: 600,
        gasBalance: 5,
        status: "paused",
      },
    ];
  });

  afterEach(() => {
    engine.shutdown();
  });

  it("initializes in idle state", () => {
    const state = engine.pipeline.getState();
    expect(state.status).toBe("idle");
    expect(state.progress).toBe(0);
  });

  it("sets and gets tasks", () => {
    engine.setTasks(tasks);
    expect(engine.getTasks()).toHaveLength(2);
    expect(engine.getTasks()[0].id).toBe(1);
  });

  it("generates proof successfully", async () => {
    engine.setTasks(tasks);
    const options: ZkProofGenerationOptions = {
      taskCondition: '{"minLiquidity": 10000}',
      secretData: '{"actualLiquidity": 25000}',
      verifierAddress: "VERIFIER123",
      simulateCongestion: false,
      simulateFailure: false,
    };

    const promise = engine.generateProof(options);
    scheduler.drain();
    const proof = await promise;

    expect(proof.status).toBe("success");
    expect(proof.proofId).toBeDefined();
    expect(engine.pipeline.getState().status).toBe("idle");
    expect(engine.pipeline.getState().proof).toEqual(proof);
  });

  it("handles generation failure", async () => {
    engine.setTasks(tasks);
    const options: ZkProofGenerationOptions = {
      taskCondition: "{}",
      secretData: "{}",
      verifierAddress: "VERIFIER123",
      simulateCongestion: false,
      simulateFailure: true,
    };

    const promise = engine.generateProof(options);
    scheduler.drain();

    await expect(promise).rejects.toThrow();
    expect(engine.pipeline.getState().status).toBe("failed");
    expect(engine.pipeline.getState().errors.length).toBeGreaterThan(0);
  });

  it("verifies proof on-chain successfully", async () => {
    engine.setTasks(tasks);
    const options: ZkProofGenerationOptions = {
      taskCondition: '{"minLiquidity": 10000}',
      secretData: '{"actualLiquidity": 25000}',
      verifierAddress: "VERIFIER123",
      simulateCongestion: false,
      simulateFailure: false,
    };

    const genPromise = engine.generateProof(options);
    scheduler.drain();
    const proof = await genPromise;
    expect(proof.status).toBe("success");

    const verPromise = engine.verifyProof(
      proof,
      "CAFE1234",
      "VERIFIER123",
      "GABC123",
      true,
    );
    scheduler.drain();

    const result = await verPromise;
    expect(result.success).toBe(true);
    expect(result.conditionHash).toBeDefined();
    expect(engine.pipeline.getState().status).toBe("success");
  });

  it("handles on-chain verification failure", async () => {
    engine.setTasks(tasks);
    const options: ZkProofGenerationOptions = {
      taskCondition: '{"minLiquidity": 10000}',
      secretData: '{"actualLiquidity": 25000}',
      verifierAddress: "VERIFIER123",
      simulateCongestion: false,
      simulateFailure: false,
    };

    const genPromise = engine.generateProof(options);
    scheduler.drain();
    const proof = await genPromise;

    const verPromise = engine.verifyProof(
      proof,
      "CAFE_FAILS",
      "VERIFIER123",
      "GABC123",
      true,
    );
    scheduler.drain();

    await expect(verPromise).rejects.toBeDefined();
  });

  it("returns worker pool stats", () => {
    const stats = engine.getWorkerPoolStats();
    expect(stats).toHaveProperty("idle");
    expect(stats).toHaveProperty("busy");
    expect(stats).toHaveProperty("total");
    expect(stats.total).toBe(2);
  });

  it("shuts down cleanly", () => {
    engine.shutdown();
    const state = engine.pipeline.getState();
    expect(state.status).toBe("idle");
    expect(state.logs).toHaveLength(0);
  });

  it("calls onStateChange when pipeline updates", () => {
    const onStateChange = jest.fn();
    const engineWithListener = new ProverEngine({
      config: {
        workerCount: 2,
        maxRetries: 2,
        baseDelayMs: 100,
        congestionMultiplier: 3,
      },
      onStateChange,
    });

    engineWithListener.pipeline.addLog("initializing", "Test");
    expect(onStateChange).toHaveBeenCalled();

    engineWithListener.shutdown();
  });

  it("handles generate + verify full lifecycle", async () => {
    engine.setTasks(tasks);
    const options: ZkProofGenerationOptions = {
      taskCondition: '{"minLiquidity": 10000}',
      secretData: '{"actualLiquidity": 25000}',
      verifierAddress: "VERIFIER123",
      simulateCongestion: false,
      simulateFailure: false,
    };

    const genPromise = engine.generateProof(options);
    scheduler.drain();
    const proof = await genPromise;
    expect(proof.status).toBe("success");

    const verPromise = engine.verifyProof(
      proof,
      "CAFE1234",
      "VERIFIER123",
      "GABC123",
      true,
    );
    scheduler.drain();
    const result = await verPromise;

    expect(result.success).toBe(true);

    const logs = engine.pipeline.getState().logs;
    expect(logs.some((l) => l.stage === "initializing")).toBe(true);
    expect(logs.some((l) => l.stage === "allocating_worker")).toBe(true);
    expect(logs.some((l) => l.stage === "proof_complete")).toBe(true);
    expect(logs.some((l) => l.stage === "verified")).toBe(true);
  });

  it("resets pipeline between generations", async () => {
    const options: ZkProofGenerationOptions = {
      taskCondition: "{}",
      secretData: "{}",
      verifierAddress: "VERIFIER123",
      simulateCongestion: false,
      simulateFailure: true,
    };

    const promise = engine.generateProof(options);
    scheduler.drain();
    await expect(promise).rejects.toThrow();
    expect(engine.pipeline.getState().status).toBe("failed");

    engine.pipeline.reset();
    expect(engine.pipeline.getState().status).toBe("idle");
  });

  it("sets pipeline to verifying state during verification", async () => {
    engine.setTasks(tasks);
    const options: ZkProofGenerationOptions = {
      taskCondition: '{"minLiquidity": 10000}',
      secretData: '{"actualLiquidity": 25000}',
      verifierAddress: "VERIFIER123",
      simulateCongestion: false,
      simulateFailure: false,
    };

    const genPromise = engine.generateProof(options);
    scheduler.drain();
    const proof = await genPromise;
    engine.pipeline.setStatus("verifying");
    expect(engine.pipeline.getState().status).toBe("verifying");
  });

  it("handles empty task list", () => {
    engine.setTasks([]);
    expect(engine.getTasks()).toHaveLength(0);
  });
});
