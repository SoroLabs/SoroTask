import { NetworkMonitor, type ConnectionQuality } from "../networkMonitor";
import { MemoryStorage } from "./mocks";

const DEFAULT_CONFIG = {
  rpcEndpoint: "https://api.example.com",
  healthCheckIntervalMs: 1_000,
  timeoutMs: 100,
  requiredConsecutiveSuccesses: 2,
  degradedAfterFailures: 3,
};

function createMonitor(overrides = {}) {
  const monitor = new NetworkMonitor({ ...DEFAULT_CONFIG, ...overrides });
  monitor.start();
  return monitor;
}

describe("NetworkMonitor", () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it("starts in an unknown state", () => {
    const monitor = createMonitor();
    const health = monitor.getHealth();
    expect(health.quality).toBe("unknown");
    expect(health.online).toBe(true);
  });

  it("records a successful probe", async () => {
    jest.useFakeTimers();
    const monitor = createMonitor({ timeoutMs: 500_000 });
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await monitor.probe();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const health = monitor.getHealth();
    expect(health.online).toBe(true);
    expect(health.consecutiveFailures).toBe(0);
    jest.useRealTimers();
  });

  it("records a failed probe", async () => {
    jest.useFakeTimers();
    const monitor = createMonitor({ timeoutMs: 500_000 });
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    await monitor.probe();
    const health = monitor.getHealth();
    expect(health.online).toBe(false);
    expect(health.consecutiveFailures).toBe(1);
    jest.useRealTimers();
  });

  it("maps latency to quality grades", async () => {
    jest.useFakeTimers();
    const monitor = createMonitor({ timeoutMs: 500_000 });

    global.fetch = jest.fn().mockImplementation(() => {
      const delay = typeof jest.advanceTimersByTimeAsync === "function"
        ? jest.advanceTimersByTimeAsync(50)
        : Promise.resolve();
      return delay.then(() => ({ ok: true }));
    });

    await monitor.probe();
    expect(monitor.getHealth().quality).toBe("excellent");

    global.fetch = jest.fn().mockImplementation(() => {
      const delay = typeof jest.advanceTimersByTimeAsync === "function"
        ? jest.advanceTimersByTimeAsync(400)
        : Promise.resolve();
      return delay.then(() => ({ ok: true }));
    });

    await monitor.probe();
    expect(monitor.getHealth().quality).toBe("good");

    jest.useRealTimers();
  });

  it("notifies subscribers on state change", async () => {
    jest.useFakeTimers();
    const monitor = createMonitor({ timeoutMs: 500_000 });
    const listener = jest.fn();
    monitor.subscribe(listener);
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await monitor.probe();
    expect(listener).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
