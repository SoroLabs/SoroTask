import {
  BASE_PROVING_MEMORY_MB,
  checkMemoryBudget,
  estimateProvingMemoryMb,
  ProverMemoryError,
  ProverUnavailableError,
  proveInBrowser,
} from "../browser-prover";

/**
 * In-browser proving engine, main-thread side (Issue #1250).
 *
 * The worker itself is not spawned here — jsdom has no module workers. What is
 * tested is every policy decision made before and around it, which is where
 * the behaviour that matters lives.
 */

/** Minimal Worker double: records posts, lets the test drive the responses. */
class FakeWorker {
  static last: FakeWorker | null = null;

  posted: unknown[] = [];
  terminated = false;
  private listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type: string, event: unknown) {
    (this.listeners.get(type) ?? []).forEach((h) => h(event));
  }

  get requestId(): string {
    return (this.posted[0] as { requestId: string }).requestId;
  }
}

function withDeviceMemory(gb: number | undefined, fn: () => void) {
  const original = Object.getOwnPropertyDescriptor(navigator, "deviceMemory");
  Object.defineProperty(navigator, "deviceMemory", { value: gb, configurable: true });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(navigator, "deviceMemory", original);
    else delete (navigator as unknown as Record<string, unknown>).deviceMemory;
  }
}

const OPTIONS = {
  input: { secret: "1" },
  wasmUrl: "/circuit.wasm",
  zkeyUrl: "/circuit.zkey",
  createWorker: () => new FakeWorker() as unknown as Worker,
};

describe("estimateProvingMemoryMb", () => {
  it("has a floor covering the runtime and proving key", () => {
    expect(estimateProvingMemoryMb(0)).toBe(BASE_PROVING_MEMORY_MB);
  });

  it("grows with constraint count", () => {
    expect(estimateProvingMemoryMb(2_000_000)).toBeGreaterThan(
      estimateProvingMemoryMb(1_000_000),
    );
  });

  it("treats a negative constraint count as zero", () => {
    expect(estimateProvingMemoryMb(-5)).toBe(BASE_PROVING_MEMORY_MB);
  });
});

describe("checkMemoryBudget", () => {
  it("proceeds when the browser does not report device memory", () => {
    // Refusing on every browser without this non-standard API would disable
    // the feature for most users.
    withDeviceMemory(undefined, () => {
      const budget = checkMemoryBudget(5_000_000);
      expect(budget.sufficient).toBe(true);
      expect(budget.availableMb).toBeNull();
    });
  });

  it("allows a small circuit on a modest device", () => {
    withDeviceMemory(8, () => {
      expect(checkMemoryBudget(100_000).sufficient).toBe(true);
    });
  });

  it("refuses a large circuit on a low-memory device", () => {
    withDeviceMemory(2, () => {
      const budget = checkMemoryBudget(10_000_000);
      expect(budget.sufficient).toBe(false);
      expect(budget.reason).toMatch(/needs about/);
    });
  });

  it("assumes only part of device memory is usable by the page", () => {
    withDeviceMemory(8, () => {
      expect(checkMemoryBudget(0).availableMb).toBe(4096);
    });
  });
});

describe("proveInBrowser", () => {
  beforeEach(() => {
    FakeWorker.last = null;
  });

  it("refuses before spawning a worker when memory is insufficient", async () => {
    // Attempting it would crash the tab and lose the user's unsaved inputs
    // along with the proof, so the refusal has to come before the spawn.
    let promise!: Promise<unknown>;
    withDeviceMemory(2, () => {
      promise = proveInBrowser({ ...OPTIONS, constraintCount: 50_000_000 });
    });

    await expect(promise).rejects.toBeInstanceOf(ProverMemoryError);
    expect(FakeWorker.last).toBeNull();
  });

  it("sends the input to the worker and resolves with the proof", async () => {
    const promise = proveInBrowser(OPTIONS);
    const worker = FakeWorker.last!;

    expect(worker.posted).toHaveLength(1);
    expect((worker.posted[0] as { input: unknown }).input).toEqual({ secret: "1" });

    worker.emit("message", {
      data: {
        type: "result",
        requestId: worker.requestId,
        proof: { pi_a: ["1"] },
        publicSignals: ["9"],
        durationMs: 1234,
      },
    });

    await expect(promise).resolves.toMatchObject({
      publicSignals: ["9"],
      durationMs: 1234,
    });
    expect(worker.terminated).toBe(true);
  });

  it("reports progress without resolving", async () => {
    const onProgress = jest.fn();
    const promise = proveInBrowser({ ...OPTIONS, onProgress });
    const worker = FakeWorker.last!;

    worker.emit("message", {
      data: {
        type: "progress",
        requestId: worker.requestId,
        stage: "witness",
        progress: 0.3,
      },
    });

    expect(onProgress).toHaveBeenCalledWith("witness", 0.3);
    expect(worker.terminated).toBe(false);

    worker.emit("message", {
      data: {
        type: "result",
        requestId: worker.requestId,
        proof: {},
        publicSignals: [],
        durationMs: 1,
      },
    });
    await promise;
  });

  it("ignores messages for a different request", async () => {
    const promise = proveInBrowser(OPTIONS);
    const worker = FakeWorker.last!;

    worker.emit("message", {
      data: { type: "result", requestId: "someone-else", proof: {}, publicSignals: [] },
    });
    expect(worker.terminated).toBe(false);

    worker.emit("message", {
      data: {
        type: "result",
        requestId: worker.requestId,
        proof: {},
        publicSignals: [],
        durationMs: 1,
      },
    });
    await promise;
  });

  it("surfaces an out-of-memory failure as a distinct error type", async () => {
    // Retrying the same proof on the same device fails the same way, so the
    // caller needs to suggest a smaller circuit rather than a retry.
    const promise = proveInBrowser(OPTIONS);
    const worker = FakeWorker.last!;

    worker.emit("message", {
      data: {
        type: "error",
        requestId: worker.requestId,
        message: "out of memory",
        outOfMemory: true,
      },
    });

    await expect(promise).rejects.toBeInstanceOf(ProverMemoryError);
  });

  it("surfaces an ordinary failure as a plain error", async () => {
    const promise = proveInBrowser(OPTIONS);
    const worker = FakeWorker.last!;

    worker.emit("message", {
      data: {
        type: "error",
        requestId: worker.requestId,
        message: "witness calculation failed",
        outOfMemory: false,
      },
    });

    await expect(promise).rejects.toThrow("witness calculation failed");
  });

  it("aborts and terminates the worker on timeout", async () => {
    jest.useFakeTimers();
    const promise = proveInBrowser({ ...OPTIONS, timeoutMs: 1000 });
    const worker = FakeWorker.last!;

    jest.advanceTimersByTime(1000);

    await expect(promise).rejects.toThrow(/exceeded 1000ms/);
    // A stuck proof would otherwise hold a worker and its memory forever.
    expect(worker.terminated).toBe(true);
    jest.useRealTimers();
  });

  it("reports a worker that fails to start as unavailable", async () => {
    await expect(
      proveInBrowser({
        ...OPTIONS,
        createWorker: () => {
          throw new Error("module workers unsupported");
        },
      }),
    ).rejects.toBeInstanceOf(ProverUnavailableError);
  });
});
