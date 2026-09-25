"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyQualityTierToDocument,
  createQualityGuard,
  getMainThreadProfiler,
  JANK_EVENT_NAME,
  readBufferedJankReports,
  resetMainThreadProfiler,
  type JankReport,
  type ProfilerSnapshot,
  type QualityTier,
} from "@/src/lib/performance";

/**
 * How often the profiler snapshot is polled to feed the quality guard. Matches
 * the profiler's own 1s frame-sampling window, so each poll sees a fresh
 * measurement rather than re-reading the same one.
 */
const QUALITY_SAMPLE_INTERVAL_MS = 1_000;

type UseJankProfilerOptions = {
  route?: string;
  autoStart?: boolean;
  sampleRate?: number;
  /**
   * Drop visual quality automatically when frame rate stays low
   * (Issue #1253). Off leaves the profiler purely observational.
   */
  adaptiveQuality?: boolean;
};

export function useJankProfiler(options: UseJankProfilerOptions = {}) {
  const { route = "/", autoStart = true, sampleRate, adaptiveQuality = true } = options;
  const profilerRef = useRef(
    getMainThreadProfiler({ route, sampleRate }),
  );
  const [qualityTier, setQualityTier] = useState<QualityTier>("high");
  const guardRef = useRef(
    createQualityGuard({
      onTierChange: (tier) => {
        setQualityTier(tier);
        applyQualityTierToDocument(tier);
      },
    }),
  );
  const [snapshot, setSnapshot] = useState<ProfilerSnapshot>(() => ({
    jankReports: [],
    frameStats: null,
    longTaskCount: 0,
    isMonitoring: false,
  }));

  const refresh = useCallback(() => {
    const next = profilerRef.current.getSnapshot();
    setSnapshot(next);

    // The guard is fed from the profiler's own sampling window rather than a
    // second rAF loop — one measurement, one consumer, no disagreement about
    // what the frame rate currently is.
    if (adaptiveQuality && next.frameStats) {
      guardRef.current.sample(next.frameStats.fps);
    }
  }, [adaptiveQuality]);

  // The user's reduced-motion preference is a decision, not a measurement: a
  // fast device must not restore animations the user asked not to see.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => guardRef.current.setReducedMotionPreference(query.matches);

    apply();
    query.addEventListener?.("change", apply);
    return () => query.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    if (autoStart && typeof window !== "undefined") {
      profilerRef.current.start();
      refresh();
    }

    const handleJank = () => refresh();
    window.addEventListener(JANK_EVENT_NAME, handleJank);

    // Jank events alone are the wrong clock for the quality guard: a page that
    // is uniformly slow but never crosses the long-task threshold would never
    // emit one, and the guard would never see a sample. Polling the profiler's
    // own window gives it a steady series regardless.
    const interval = window.setInterval(refresh, QUALITY_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener(JANK_EVENT_NAME, handleJank);
      profilerRef.current.stop();
    };
  }, [autoStart, refresh]);

  const start = useCallback(() => {
    profilerRef.current.start();
    refresh();
  }, [refresh]);

  const stop = useCallback(() => {
    profilerRef.current.stop();
    refresh();
  }, [refresh]);

  const measureInteraction = useCallback(
    async <T>(label: string, action: () => T | Promise<T>) => {
      const outcome = await profilerRef.current.measureInteraction(label, action);
      refresh();
      return outcome;
    },
    [refresh],
  );

  const getReports = useCallback((): JankReport[] => {
    return readBufferedJankReports();
  }, []);

  return {
    snapshot,
    start,
    stop,
    measureInteraction,
    getReports,
    refresh,
    reset: resetMainThreadProfiler,
    /** Current visual quality tier (Issue #1253). */
    qualityTier,
    /** Whether decorative animation is worth running at this tier. */
    animationsEnabled: qualityTier === "high",
    /** Force a tier, for the developer overlay. */
    setQualityTier: (tier: QualityTier) => guardRef.current.override(tier),
  };
}
