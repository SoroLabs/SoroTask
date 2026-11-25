export {
  classifySeverity,
  createJankDetector,
  createJankReport,
  readBufferedJankReports,
} from "./jank-detector";
export {
  createMainThreadProfiler,
  getMainThreadProfiler,
  resetMainThreadProfiler,
} from "./profiler";
export {
  JANK_EVENT_NAME,
  type FrameStats,
  type JankDetectorOptions,
  type JankEventDetail,
  type JankReport,
  type JankSeverity,
  type JankSource,
  type ProfilerSnapshot,
} from "./types";

export {
  applyQualityTierToDocument,
  createQualityGuard,
  DEFAULT_DEGRADE_BELOW_FPS,
  DEFAULT_MINIMAL_BELOW_FPS,
  DEFAULT_RESTORE_ABOVE_FPS,
  QUALITY_TIER_ATTRIBUTE,
  type QualityGuard,
  type QualityGuardOptions,
  type QualityTier,
} from "./quality-guard";

export {
  getRenderRecords,
  recordRender,
  resetRenderRecords,
  SLOW_RENDER_THRESHOLD_MS,
  type RenderRecord,
} from "./render-audit";
