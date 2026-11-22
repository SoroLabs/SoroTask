"use client";

import { createContext, useContext, useMemo } from "react";
import { useJankProfiler } from "@/src/hooks/useJankProfiler";
import { usePathname } from "next/navigation";
import type { QualityTier } from "@/src/lib/performance";

type JankProfilerProviderProps = {
  children: React.ReactNode;
  enabled?: boolean;
  /**
   * Automatically drop visual quality when frame rate stays low (Issue #1253).
   * Disable to keep the profiler observational.
   */
  adaptiveQuality?: boolean;
};

type QualityContextValue = {
  tier: QualityTier;
  /**
   * Whether decorative animation is worth running. Components should branch on
   * this rather than on the tier name, so adding a tier does not require
   * editing every animated component.
   */
  animationsEnabled: boolean;
  setTier: (tier: QualityTier) => void;
};

const QualityContext = createContext<QualityContextValue>({
  tier: "high",
  animationsEnabled: true,
  setTier: () => {},
});

/**
 * Read the current visual quality tier.
 *
 * Safe outside the provider: it falls back to full quality rather than
 * throwing, because a component rendered in a test or a storybook story should
 * not have to mount the profiler to render at all.
 */
export function useQualityTier(): QualityContextValue {
  return useContext(QualityContext);
}

export function JankProfilerProvider({
  children,
  enabled = process.env.NEXT_PUBLIC_JANK_PROFILER_ENABLED !== "0",
  adaptiveQuality = process.env.NEXT_PUBLIC_ADAPTIVE_QUALITY !== "0",
}: JankProfilerProviderProps) {
  const pathname = usePathname();

  const { qualityTier, animationsEnabled, setQualityTier } = useJankProfiler({
    route: pathname ?? "/",
    autoStart: enabled,
    sampleRate: Number(process.env.NEXT_PUBLIC_JANK_SAMPLE_RATE ?? "1"),
    adaptiveQuality: enabled && adaptiveQuality,
  });

  const value = useMemo<QualityContextValue>(
    () => ({
      tier: qualityTier,
      animationsEnabled,
      setTier: setQualityTier,
    }),
    [qualityTier, animationsEnabled, setQualityTier],
  );

  return <QualityContext.Provider value={value}>{children}</QualityContext.Provider>;
}
