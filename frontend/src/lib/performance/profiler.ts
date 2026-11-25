import { createJankDetector } from "./jank-detector";
import type {
  FrameStats,
  JankDetectorOptions,
  JankReport,
  ProfilerSnapshot,
} from "./types";

export type ProfilerOptions = JankDetectorOptions & {
  frameSampleWindowMs?: number;
};

export function createMainThreadProfiler(options: ProfilerOptions = {}) {
  const frameSampleWindowMs = options.frameSampleWindowMs ?? 1000;
  const detector = createJankDetector(options);

  let frameSampleRafId: number | null = null;
  let frameSampleStart = 0;
  let framesInWindow = 0;
  let latestFrameStats: FrameStats | null = null;

  const sampleFrames = (timestamp: number) => {
    if (!detector.isMonitoring()) {
      return;
    }

    if (frameSampleStart === 0) {
      frameSampleStart = timestamp;
    }

    framesInWindow += 1;
    const elapsed = timestamp - frameSampleStart;

    if (elapsed >= frameSampleWindowMs) {
      latestFrameStats = {
        fps: Number(((framesInWindow / elapsed) * 1000).toFixed(1)),
        droppedFrames: detector.getDroppedFrameCount(),
        sampleWindowMs: Math.round(elapsed),
      };
      framesInWindow = 0;
      frameSampleStart = timestamp;
    }

    frameSampleRafId = window.requestAnimationFrame(sampleFrames);
  };

  const start = () => {
    if (typeof window === "undefined") {
      return;
    }

    detector.start();
    frameSampleStart = 0;
    framesInWindow = 0;
    frameSampleRafId = window.requestAnimationFrame(sampleFrames);
  };

  const stop = () => {
    detector.stop();

    if (frameSampleRafId !== null) {
      window.cancelAnimationFrame(frameSampleRafId);
      frameSampleRafId = null;
    }
  };

  const measureInteraction = async <T>(
    label: string,
    action: () => T | Promise<T>,
  ): Promise<{ result: T; report: JankReport | null }> => {
    const startedAt = performance.now();
    const result = await action();
    const duration = performance.now() - startedAt;
    const report = detector.reportInteraction(duration, { label });
    return { result, report };
  };

  const getSnapshot = (): ProfilerSnapshot => {
    const reports = detector.getBufferedReports();
    return {
      jankReports: reports,
      frameStats: latestFrameStats,
      longTaskCount: reports.filter((r) => r.source === "longtask").length,
      isMonitoring: detector.isMonitoring(),
    };
  };

  return {
    start,
    stop,
    measureInteraction,
    getSnapshot,
    reportInteraction: detector.reportInteraction,
    getBufferedReports: detector.getBufferedReports,
    isMonitoring: detector.isMonitoring,
  };
}

let globalProfiler: ReturnType<typeof createMainThreadProfiler> | null = null;

export function getMainThreadProfiler(
  options?: ProfilerOptions,
): ReturnType<typeof createMainThreadProfiler> {
  if (!globalProfiler) {
    globalProfiler = createMainThreadProfiler(options);
  }
  return globalProfiler;
}

export function resetMainThreadProfiler(): void {
  globalProfiler?.stop();
  globalProfiler = null;
}
