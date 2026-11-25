import { clampSampleRate, shouldSample } from "../frontend-performance";
import {
  JANK_EVENT_NAME,
  type JankDetectorOptions,
  type JankEventDetail,
  type JankReport,
  type JankSeverity,
  type JankSource,
} from "./types";

const DEFAULT_LONG_TASK_THRESHOLD_MS = 50;
const DEFAULT_FRAME_DROP_THRESHOLD_MS = 32;
const DEFAULT_BUFFER_LIMIT = 50;

export function classifySeverity(
  durationMs: number,
  source: JankSource,
): JankSeverity {
  if (source === "frame_drop") {
    if (durationMs >= 200) return "critical";
    if (durationMs >= 100) return "high";
    if (durationMs >= 50) return "medium";
    return "low";
  }

  if (durationMs >= 500) return "critical";
  if (durationMs >= 200) return "high";
  if (durationMs >= 100) return "medium";
  return "low";
}

export function createJankReport(
  source: JankSource,
  duration: number,
  route: string,
  metadata?: Record<string, string | number | boolean | null>,
): JankReport {
  const roundedDuration = Math.max(0, Number(duration.toFixed(2)));
  return {
    id: `jank-${source}-${Date.now()}-${Math.round(roundedDuration)}`,
    source,
    duration: roundedDuration,
    severity: classifySeverity(roundedDuration, source),
    route,
    sampledAt: new Date().toISOString(),
    metadata,
  };
}

function emitReport(report: JankReport, onReport?: (report: JankReport) => void) {
  if (typeof window !== "undefined") {
    const existing = window.__SOROTASK_JANK_REPORTS__ ?? [];
    window.__SOROTASK_JANK_REPORTS__ = [report, ...existing].slice(
      0,
      DEFAULT_BUFFER_LIMIT,
    );

    window.dispatchEvent(
      new CustomEvent<JankEventDetail>(JANK_EVENT_NAME, {
        detail: { report },
      }),
    );

    if (process.env.NEXT_PUBLIC_JANK_DEBUG === "1") {
      console.debug("[jank]", report);
    }
  }

  onReport?.(report);
}

export function readBufferedJankReports(): JankReport[] {
  if (typeof window === "undefined") {
    return [];
  }
  return window.__SOROTASK_JANK_REPORTS__ ?? [];
}

export function createJankDetector(options: JankDetectorOptions = {}) {
  const route = options.route ?? "/";
  const longTaskThreshold =
    options.longTaskThresholdMs ?? DEFAULT_LONG_TASK_THRESHOLD_MS;
  const frameDropThreshold =
    options.frameDropThresholdMs ?? DEFAULT_FRAME_DROP_THRESHOLD_MS;
  const bufferLimit = options.bufferLimit ?? DEFAULT_BUFFER_LIMIT;
  const sampleRate = clampSampleRate(options.sampleRate ?? 1);

  let longTaskObserver: PerformanceObserver | null = null;
  let frameRafId: number | null = null;
  let lastFrameTime = 0;
  let droppedFrames = 0;
  let isMonitoring = false;

  const report = (
    source: JankSource,
    duration: number,
    metadata?: Record<string, string | number | boolean | null>,
  ) => {
    if (!shouldSample(sampleRate)) {
      return null;
    }

    const jankReport = createJankReport(source, duration, route, metadata);
    emitReport(jankReport, options.onReport);
    return jankReport;
  };

  const handleLongTask = (entry: PerformanceEntry) => {
    if (entry.duration < longTaskThreshold) {
      return;
    }

    report("longtask", entry.duration, {
      entryType: entry.entryType,
      name: entry.name,
      startTime: entry.startTime,
    });
  };

  const frameLoop = (timestamp: number) => {
    if (!isMonitoring) {
      return;
    }

    if (lastFrameTime > 0) {
      const delta = timestamp - lastFrameTime;
      if (delta > frameDropThreshold) {
        droppedFrames += 1;
        report("frame_drop", delta, {
          droppedFrames,
          expectedFrameMs: 16.67,
        });
      }
    }

    lastFrameTime = timestamp;
    frameRafId = window.requestAnimationFrame(frameLoop);
  };

  const start = () => {
    if (isMonitoring || typeof window === "undefined") {
      return;
    }

    isMonitoring = true;
    lastFrameTime = 0;
    droppedFrames = 0;

    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ) {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            handleLongTask(entry);
          }
        });
        longTaskObserver.observe({ entryTypes: ["longtask"] });
      } catch {
        longTaskObserver = null;
      }
    }

    frameRafId = window.requestAnimationFrame(frameLoop);
  };

  const stop = () => {
    isMonitoring = false;

    if (longTaskObserver) {
      longTaskObserver.disconnect();
      longTaskObserver = null;
    }

    if (frameRafId !== null) {
      window.cancelAnimationFrame(frameRafId);
      frameRafId = null;
    }

    lastFrameTime = 0;
  };

  const reportInteraction = (
    duration: number,
    metadata?: Record<string, string | number | boolean | null>,
  ) => report("interaction", duration, metadata);

  const getDroppedFrameCount = () => droppedFrames;

  const getBufferedReports = () =>
    readBufferedJankReports().slice(0, bufferLimit);

  return {
    start,
    stop,
    report,
    reportInteraction,
    getDroppedFrameCount,
    getBufferedReports,
    isMonitoring: () => isMonitoring,
  };
}
