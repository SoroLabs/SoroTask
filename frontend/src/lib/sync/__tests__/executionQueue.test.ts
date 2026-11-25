/**
 * @jest-environment jsdom
 */
import { ExecutionQueue, ExecutionQueueError, type ExecutionQueueHandler } from "../executionQueue";
import { MemoryStorage } from "./mocks";

const DEFAULT_QUEUE_CONFIG = {
  storageKey: "test-sync-queue",
  maxAttempts: 3,
  baseDelayMs: 10,
  maxDelayMs: 100,
};

function createQueue(handlers: ExecutionQueueHandler) {
  return new ExecutionQueue(handlers, DEFAULT_QUEUE_CONFIG);
}

describe("ExecutionQueue", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    jest.spyOn(Storage.prototype, "getItem").mockImplementation((key) => storage.getItem(key));
    jest.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => storage.setItem(key, value));
  });

  it("executes a handler when online", async () => {
    const handler: ExecutionQueueHandler = { execute: jest.fn().mockResolvedValue(undefined) };
    const queue = createQueue(handler);
    queue.setOnline(true);
    const action = queue.enqueue("task.execute", {
      taskId: "t1",
      functionName: "harvest",
      contractAddress: "C123",
      gasEstimate: 500,
    }, 10, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(action.attempts).toBe(1);
  });

  it("retries on failure with backoff", async () => {
    jest.useFakeTimers();
    const handler: ExecutionQueueHandler = {
      execute: jest.fn()
        .mockRejectedValueOnce(new Error("first"))
        .mockRejectedValueOnce(new Error("second"))
        .mockResolvedValue(undefined),
    };
    const queue = createQueue(handler);
    queue.setOnline(true);
    queue.enqueue("task.execute", {
      taskId: "t1",
      functionName: "harvest",
      contractAddress: "C123",
      gasEstimate: 500,
    }, 10, true);
    await jest.advanceTimersByTimeAsync(DEFAULT_QUEUE_CONFIG.maxDelayMs + 1);
    expect(handler.execute).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });

  it("marks action failed after max attempts", async () => {
    jest.useFakeTimers();
    const handler: ExecutionQueueHandler = {
      execute: jest.fn().mockRejectedValue(new Error("boom")),
    };
    const queue = createQueue(handler);
    queue.setOnline(true);
    const action = queue.enqueue("task.execute", {
      taskId: "t1",
      functionName: "harvest",
      contractAddress: "C123",
      gasEstimate: 500,
    }, 10, true);
    await jest.advanceTimersByTimeAsync(DEFAULT_QUEUE_CONFIG.maxDelayMs * 10);
    expect(action.attempts).toBe(DEFAULT_QUEUE_CONFIG.maxAttempts);
    jest.useRealTimers();
  });

  it("cancels a queued action", async () => {
    const handler: ExecutionQueueHandler = { execute: jest.fn().mockResolvedValue(undefined) };
    const queue = createQueue(handler);
    const action = queue.enqueue("task.execute", {
      taskId: "t1",
      functionName: "harvest",
      contractAddress: "C123",
      gasEstimate: 500,
    }, 10, false);
    queue.cancel(action.id);
    const all = queue.getActions();
    expect(all.some((a) => a.id === action.id && a.status === "cancelled")).toBe(true);
  });
});
