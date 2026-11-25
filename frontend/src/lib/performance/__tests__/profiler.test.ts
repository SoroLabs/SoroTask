import {
  createMainThreadProfiler,
  getMainThreadProfiler,
  resetMainThreadProfiler,
} from "../profiler";

describe("main thread profiler", () => {
  beforeEach(() => {
    window.__SOROTASK_JANK_REPORTS__ = [];
    resetMainThreadProfiler();
  });

  afterEach(() => {
    resetMainThreadProfiler();
  });

  it("returns a profiler snapshot", () => {
    const profiler = createMainThreadProfiler({ route: "/dashboard" });

    const snapshot = profiler.getSnapshot();

    expect(snapshot.jankReports).toEqual([]);
    expect(snapshot.longTaskCount).toBe(0);
    expect(snapshot.isMonitoring).toBe(false);
  });

  it("measures interaction duration", async () => {
    const profiler = createMainThreadProfiler({ route: "/", sampleRate: 1 });

    const { result, report } = await profiler.measureInteraction(
      "test-action",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(report).not.toBeNull();
    expect(report?.source).toBe("interaction");
    expect(report?.metadata?.label).toBe("test-action");
  });

  it("reuses a singleton profiler instance", () => {
    const first = getMainThreadProfiler({ route: "/a" });
    const second = getMainThreadProfiler({ route: "/b" });

    expect(first).toBe(second);
  });

  it("starts and stops monitoring", () => {
    const profiler = createMainThreadProfiler({ route: "/" });

    profiler.start();
    expect(profiler.isMonitoring()).toBe(true);

    profiler.stop();
    expect(profiler.isMonitoring()).toBe(false);
  });
});
