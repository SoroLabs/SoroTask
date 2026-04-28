import {
  clampSampleRate,
  createPerformanceMonitor,
  PERFORMANCE_EVENT_NAME,
  shouldSample,
} from "./frontend-performance";

describe("frontend performance monitor", () => {
  beforeEach(() => {
    window.__SOROTASK_PERF_METRICS__ = [];
  });

  it("clamps invalid sample rates", () => {
    expect(clampSampleRate(-1)).toBe(0);
    expect(clampSampleRate(2)).toBe(1);
    expect(clampSampleRate(Number.NaN)).toBe(1);
  });

  it("samples deterministically when given an explicit random value", () => {
    expect(shouldSample(0.5, 0.1)).toBe(true);
    expect(shouldSample(0.5, 0.9)).toBe(false);
  });

  it("buffers and emits sampled metrics", () => {
    const listener = jest.fn();
    window.addEventListener(PERFORMANCE_EVENT_NAME, listener);

    const monitor = createPerformanceMonitor({
      route: "/tasks",
      sampleRate: 1,
    });

    const metric = monitor.report("task_open", 42.4, {
      taskId: "TASK-1",
    });

    expect(metric).not.toBeNull();
    expect(window.__SOROTASK_PERF_METRICS__).toHaveLength(1);
    expect(window.__SOROTASK_PERF_METRICS__?.[0].name).toBe("task_open");
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(PERFORMANCE_EVENT_NAME, listener);
  });
});
