import { ActionQueue, createActionQueue } from "../actionQueue";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  raw(): Map<string, string> {
    return this.store;
  }
}

interface TestDeps {
  queue: ActionQueue;
  storage: MemoryStorage;
  scheduled: Array<{ ms: number; fn: () => void }>;
  settle: () => Promise<void>;
  runScheduled: () => Promise<void>;
}

// Drain pending microtasks. Each dispatch involves a chain of awaits
// (handler invocation, replace, persist, notify), so a single
// `await Promise.resolve()` is not enough — flush several ticks.
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

function makeQueue(
  options: {
    storage?: MemoryStorage;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    storageKey?: string;
  } = {},
): TestDeps {
  const storage = options.storage ?? new MemoryStorage();
  const scheduled: Array<{ ms: number; fn: () => void }> = [];
  const clock = { current: 1_000_000 };
  const queue = createActionQueue({
    storageKey: options.storageKey ?? "test-queue",
    maxAttempts: options.maxAttempts ?? 3,
    baseDelayMs: options.baseDelayMs ?? 100,
    maxDelayMs: options.maxDelayMs ?? 1_000,
    storage,
    schedule: (fn, ms) => {
      scheduled.push({ ms, fn });
    },
    now: () => clock.current,
  });
  const settle = drainMicrotasks;
  const runScheduled = async () => {
    // A scheduled retry can fail and schedule another retry, so loop
    // until no more retries are pending. Advance the clock past each
    // delay so flush()'s nextAttemptAt gate is satisfied.
    while (scheduled.length > 0) {
      const next = scheduled.shift();
      if (next) {
        clock.current += next.ms;
        next.fn();
        await drainMicrotasks();
      }
    }
  };
  return { queue, storage, scheduled, settle, runScheduled };
}

describe("ActionQueue", () => {
  it("does not dispatch while offline", async () => {
    const { queue } = makeQueue();
    const handler = jest.fn().mockResolvedValue(undefined);
    queue.registerHandler("ping", handler);
    queue.enqueue("ping", { x: 1 });
    await queue.flush();
    expect(handler).not.toHaveBeenCalled();
    expect(queue.getActions()[0].status).toBe("pending");
  });

  it("dispatches immediately when online and the handler succeeds", async () => {
    const { queue, settle } = makeQueue();
    const handler = jest.fn().mockResolvedValue(undefined);
    queue.registerHandler("ping", handler);
    queue.setOnline(true);
    queue.enqueue("ping", { x: 1 });
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(queue.getActions()[0].status).toBe("succeeded");
    expect(queue.getActions()[0].attempts).toBe(1);
  });

  it("retries on failure with backoff and eventually succeeds", async () => {
    const { queue, settle, runScheduled } = makeQueue({
      maxAttempts: 5,
      baseDelayMs: 100,
    });
    let calls = 0;
    queue.registerHandler("flaky", async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
    });
    queue.setOnline(true);
    queue.enqueue("flaky", {});
    await settle();
    expect(queue.getActions()[0].status).toBe("pending");
    expect(queue.getActions()[0].lastError).toBe("transient");
    expect(queue.getActions()[0].attempts).toBe(1);
    await runScheduled();
    expect(calls).toBe(3);
    expect(queue.getActions()[0].status).toBe("succeeded");
    expect(queue.getActions()[0].attempts).toBe(3);
    expect(queue.getActions()[0].lastError).toBeUndefined();
  });

  it("marks an action failed once max attempts is exceeded", async () => {
    const { queue, settle, runScheduled } = makeQueue({ maxAttempts: 2 });
    queue.registerHandler("doomed", async () => {
      throw new Error("nope");
    });
    queue.setOnline(true);
    queue.enqueue("doomed", {});
    await settle();
    await runScheduled();
    const action = queue.getActions()[0];
    expect(action.status).toBe("failed");
    expect(action.attempts).toBe(2);
    expect(action.lastError).toBe("nope");
  });

  it("fails fast with a clear error when no handler is registered", async () => {
    const { queue, settle } = makeQueue();
    queue.setOnline(true);
    queue.enqueue("orphan", {});
    await settle();
    const action = queue.getActions()[0];
    expect(action.status).toBe("failed");
    expect(action.lastError).toContain("orphan");
  });

  it("flushes all pending actions when toggled online", async () => {
    const { queue, settle } = makeQueue();
    const handler = jest.fn().mockResolvedValue(undefined);
    queue.registerHandler("ping", handler);
    queue.enqueue("ping", { i: 1 });
    queue.enqueue("ping", { i: 2 });
    queue.enqueue("ping", { i: 3 });
    expect(handler).not.toHaveBeenCalled();
    queue.setOnline(true);
    await settle();
    expect(handler).toHaveBeenCalledTimes(3);
    expect(queue.getActions().every((a) => a.status === "succeeded")).toBe(
      true,
    );
  });

  it("persists across instances via the supplied storage", async () => {
    const storage = new MemoryStorage();
    const a = makeQueue({ storage, storageKey: "shared" });
    a.queue.enqueue("ping", { i: 1 });
    a.queue.enqueue("ping", { i: 2 });
    expect(storage.getItem("shared")).not.toBeNull();

    // New queue instance loads the persisted state.
    const b = makeQueue({ storage, storageKey: "shared" });
    expect(b.queue.getActions()).toHaveLength(2);
    expect(b.queue.getActions()[0].status).toBe("pending");
  });

  it("demotes in_flight actions to pending on reload", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "shared",
      JSON.stringify([
        {
          id: "abc",
          type: "ping",
          payload: {},
          status: "in_flight",
          enqueuedAt: 1,
          attempts: 1,
        },
      ]),
    );
    const { queue } = makeQueue({ storage, storageKey: "shared" });
    expect(queue.getActions()[0].status).toBe("pending");
  });

  it("recovers from corrupted storage by starting fresh", () => {
    const storage = new MemoryStorage();
    storage.setItem("shared", "{not json}");
    const { queue } = makeQueue({ storage, storageKey: "shared" });
    expect(queue.getActions()).toEqual([]);
  });

  it("supports cancel, retry, and remove", async () => {
    const { queue, settle, runScheduled } = makeQueue({ maxAttempts: 1 });
    queue.registerHandler("a", async () => {
      throw new Error("x");
    });

    // Run "a" online so it actually fails.
    queue.setOnline(true);
    const a = queue.enqueue("a", {});
    await settle();
    await runScheduled();
    expect(queue.getActions().find((x) => x.id === a.id)?.status).toBe(
      "failed",
    );

    // Enqueue "b" while offline so cancel can run before any dispatch.
    queue.setOnline(false);
    const b = queue.enqueue("b", {});
    queue.cancel(b.id);
    expect(queue.getActions().find((x) => x.id === b.id)?.status).toBe(
      "cancelled",
    );

    // Retry the failed one — register a handler that succeeds this time.
    queue.registerHandler("a", async () => {
      // success
    });
    queue.setOnline(true);
    queue.retry(a.id);
    await settle();
    expect(queue.getActions().find((x) => x.id === a.id)?.status).toBe(
      "succeeded",
    );

    queue.remove(b.id);
    expect(queue.getActions().some((x) => x.id === b.id)).toBe(false);
  });

  it("clearCompleted removes succeeded and cancelled but keeps failed", async () => {
    const { queue, settle, runScheduled } = makeQueue({ maxAttempts: 1 });
    queue.registerHandler("ok", async () => undefined);
    queue.registerHandler("bad", async () => {
      throw new Error("x");
    });
    queue.setOnline(false);

    queue.enqueue("ok", {});
    const bad = queue.enqueue("bad", {});
    const cancellable = queue.enqueue("ok", {});
    queue.cancel(cancellable.id);

    queue.setOnline(true);
    await settle();
    await runScheduled();

    queue.clearCompleted();
    const remaining = queue.getActions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(bad.id);
    expect(remaining[0].status).toBe("failed");
  });

  it("notifies subscribers on every state change", () => {
    const { queue } = makeQueue();
    const listener = jest.fn();
    const unsubscribe = queue.subscribe(listener);
    queue.enqueue("ping", {});
    queue.cancel(queue.getActions()[0].id);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    unsubscribe();
    queue.enqueue("ping", {});
    // Listener count should not have grown after unsubscribe.
    const callsAfter = listener.mock.calls.length;
    queue.cancel(queue.getActions()[1].id);
    expect(listener.mock.calls.length).toBe(callsAfter);
  });

  it("returns a fresh array reference after every mutation", () => {
    const { queue } = makeQueue();
    const before = queue.getActions();
    queue.enqueue("ping", {});
    const after = queue.getActions();
    expect(after).not.toBe(before);
  });
});
