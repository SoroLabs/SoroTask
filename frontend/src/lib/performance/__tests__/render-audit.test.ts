import {
  getRenderRecords,
  recordRender,
  resetRenderRecords,
  SLOW_RENDER_THRESHOLD_MS,
} from "../render-audit";

/**
 * Slow render reporting (Issue #1253).
 *
 * Gated on development, so the tests set NODE_ENV explicitly rather than
 * assuming the runner's value.
 */

const ORIGINAL_ENV = process.env.NODE_ENV;

function setEnv(value: string) {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true });
}

describe("recordRender", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    setEnv("development");
    resetRenderRecords();
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    setEnv(ORIGINAL_ENV ?? "test");
  });

  it("ignores renders faster than the threshold", () => {
    expect(recordRender("TaskList", "update", 5, 4)).toBeNull();
    expect(getRenderRecords()).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("records and warns on a slow render", () => {
    const record = recordRender("TaskGraph", "mount", 42.345, 40);

    expect(record).not.toBeNull();
    expect(record?.component).toBe("TaskGraph");
    expect(record?.actualDurationMs).toBe(42.35);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("TaskGraph");
  });

  it("uses one frame at 60fps as the default threshold", () => {
    expect(SLOW_RENDER_THRESHOLD_MS).toBe(16);
    expect(recordRender("Chart", "update", 15.9, 15)).toBeNull();
    expect(recordRender("Chart", "update", 16.1, 15)).not.toBeNull();
  });

  it("throttles repeat warnings for the same component", () => {
    const base = 1_700_000_000_000;
    recordRender("Ticker", "update", 30, 28, SLOW_RENDER_THRESHOLD_MS, base);
    recordRender("Ticker", "update", 30, 28, SLOW_RENDER_THRESHOLD_MS, base + 100);
    recordRender("Ticker", "update", 30, 28, SLOW_RENDER_THRESHOLD_MS, base + 500);

    // A list re-rendering on every keystroke would otherwise bury every other
    // warning in the console.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getRenderRecords()).toHaveLength(3);
  });

  it("warns again once the throttle window has passed", () => {
    const base = 1_700_000_000_000;
    recordRender("Ticker", "update", 30, 28, SLOW_RENDER_THRESHOLD_MS, base);
    recordRender("Ticker", "update", 30, 28, SLOW_RENDER_THRESHOLD_MS, base + 6_000);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("throttles per component rather than globally", () => {
    const base = 1_700_000_000_000;
    recordRender("A", "update", 30, 28, SLOW_RENDER_THRESHOLD_MS, base);
    recordRender("B", "update", 30, 28, SLOW_RENDER_THRESHOLD_MS, base + 100);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does nothing outside development", () => {
    setEnv("production");
    expect(recordRender("TaskGraph", "mount", 500, 400)).toBeNull();
    expect(getRenderRecords()).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("caps the retained record buffer", () => {
    for (let i = 0; i < 150; i += 1) {
      recordRender(`Component${i}`, "update", 20, 18);
    }
    expect(getRenderRecords().length).toBeLessThanOrEqual(100);
  });
});
