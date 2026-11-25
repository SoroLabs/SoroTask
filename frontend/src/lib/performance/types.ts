export type JankSeverity = "low" | "medium" | "high" | "critical";

export type JankSource = "longtask" | "frame_drop" | "interaction";

export type JankReport = {
  id: string;
  source: JankSource;
  duration: number;
  severity: JankSeverity;
  route: string;
  sampledAt: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type FrameStats = {
  fps: number;
  droppedFrames: number;
  sampleWindowMs: number;
};

export type ProfilerSnapshot = {
  jankReports: JankReport[];
  frameStats: FrameStats | null;
  longTaskCount: number;
  isMonitoring: boolean;
};

export type JankDetectorOptions = {
  route?: string;
  longTaskThresholdMs?: number;
  frameDropThresholdMs?: number;
  bufferLimit?: number;
  sampleRate?: number;
  onReport?: (report: JankReport) => void;
};

export const JANK_EVENT_NAME = "sorotask:jank-report";

export type JankEventDetail = {
  report: JankReport;
};

declare global {
  interface Window {
    __SOROTASK_JANK_REPORTS__?: JankReport[];
  }
}
