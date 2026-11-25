import {
  classifySeverity,
  createJankDetector,
  createJankReport,
  readBufferedJankReports,
} from "../jank-detector";
import { JANK_EVENT_NAME } from "../types";

describe("jank detector", () => {
  beforeEach(() => {
    window.__SOROTASK_JANK_REPORTS__ = [];
  });

  it("classifies severity by duration and source", () => {
    expect(classifySeverity(30, "longtask")).toBe("low");
    expect(classifySeverity(150, "longtask")).toBe("medium");
    expect(classifySeverity(250, "longtask")).toBe("high");
    expect(classifySeverity(600, "longtask")).toBe("critical");
    expect(classifySeverity(120, "frame_drop")).toBe("high");
  });

  it("creates structured jank reports", () => {
    const report = createJankReport("interaction", 72.5, "/dashboard", {
      label: "open-task",
    });

    expect(report.source).toBe("interaction");
    expect(report.duration).toBe(72.5);
    expect(report.route).toBe("/dashboard");
    expect(report.severity).toBe("low");
    expect(report.metadata?.label).toBe("open-task");
  });

  it("buffers and emits jank reports", () => {
    const listener = jest.fn();
    window.addEventListener(JANK_EVENT_NAME, listener);

    const detector = createJankDetector({
      route: "/tasks",
      sampleRate: 1,
    });

    const report = detector.report("interaction", 88, { label: "search" });

    expect(report).not.toBeNull();
    expect(readBufferedJankReports()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(JANK_EVENT_NAME, listener);
  });

  it("respects sample rate for reports", () => {
    const detector = createJankDetector({
      route: "/tasks",
      sampleRate: 0,
    });

    const report = detector.report("interaction", 120);
    expect(report).toBeNull();
    expect(readBufferedJankReports()).toHaveLength(0);
  });

  it("tracks monitoring lifecycle", () => {
    const detector = createJankDetector({ route: "/" });

    expect(detector.isMonitoring()).toBe(false);
    detector.start();
    expect(detector.isMonitoring()).toBe(true);
    detector.stop();
    expect(detector.isMonitoring()).toBe(false);
  });

  it("reports interaction latency via helper", () => {
    const detector = createJankDetector({ route: "/", sampleRate: 1 });
    const report = detector.reportInteraction(95, { label: "mutation" });

    expect(report?.source).toBe("interaction");
    expect(report?.metadata?.label).toBe("mutation");
  });
});
