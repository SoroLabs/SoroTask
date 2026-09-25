/**
 * Automatic visual quality degradation (Issue #1253).
 *
 * The profiler already reports long tasks and dropped frames. That tells a
 * developer the page janked; it does nothing for the user whose device is
 * janking right now. This turns the same signal into an action: when frame
 * rate stays below a threshold, the UI drops to a cheaper rendering mode.
 *
 * # Why sustained FPS rather than a single sample
 *
 * One bad second is normal — a route transition, a chart mounting, a garbage
 * collection pause. Reacting to it would make the UI flip modes constantly,
 * which is more distracting than the jank it is trying to avoid. A tier change
 * requires the threshold to be breached across several consecutive samples.
 *
 * # Why recovery is harder than degradation
 *
 * The thresholds are deliberately asymmetric. Degrading at 45fps and restoring
 * at 45fps would oscillate for any device sitting near the line, because
 * degrading raises the frame rate and immediately re-qualifies the device for
 * the mode that was too expensive. Restoring requires a clearly higher frame
 * rate, sustained for longer.
 */

export type QualityTier = "high" | "reduced" | "minimal";

export type QualityGuardOptions = {
  /** Below this sustained FPS the tier drops. */
  degradeBelowFps?: number;
  /** Below this sustained FPS the tier drops again, to minimal. */
  minimalBelowFps?: number;
  /** Above this sustained FPS the tier recovers. Must exceed `degradeBelowFps`. */
  restoreAboveFps?: number;
  /** Consecutive samples below the threshold before degrading. */
  degradeAfterSamples?: number;
  /** Consecutive samples above the threshold before restoring. */
  restoreAfterSamples?: number;
  onTierChange?: (tier: QualityTier, previous: QualityTier) => void;
};

/** The threshold named in the issue: below 45fps, animations come off. */
export const DEFAULT_DEGRADE_BELOW_FPS = 45;
export const DEFAULT_MINIMAL_BELOW_FPS = 25;
/**
 * Restoring needs a clearly better frame rate than degrading, or a device
 * hovering at the line oscillates between tiers every few seconds.
 */
export const DEFAULT_RESTORE_ABOVE_FPS = 55;
export const DEFAULT_DEGRADE_AFTER_SAMPLES = 3;
/** Recovery is slower than degradation: a brief calm is not a recovery. */
export const DEFAULT_RESTORE_AFTER_SAMPLES = 8;

const TIER_ORDER: QualityTier[] = ["high", "reduced", "minimal"];

/** Attribute the stylesheet keys off to switch effects off wholesale. */
export const QUALITY_TIER_ATTRIBUTE = "data-quality-tier";

export type QualityGuard = ReturnType<typeof createQualityGuard>;

export function createQualityGuard(options: QualityGuardOptions = {}) {
  const degradeBelow = options.degradeBelowFps ?? DEFAULT_DEGRADE_BELOW_FPS;
  const minimalBelow = options.minimalBelowFps ?? DEFAULT_MINIMAL_BELOW_FPS;
  const restoreAbove = options.restoreAboveFps ?? DEFAULT_RESTORE_ABOVE_FPS;
  const degradeAfter = options.degradeAfterSamples ?? DEFAULT_DEGRADE_AFTER_SAMPLES;
  const restoreAfter = options.restoreAfterSamples ?? DEFAULT_RESTORE_AFTER_SAMPLES;

  if (restoreAbove <= degradeBelow) {
    // Equal thresholds guarantee oscillation, so this is a configuration
    // error rather than a preference.
    throw new Error(
      `restoreAboveFps (${restoreAbove}) must be greater than degradeBelowFps (${degradeBelow})`,
    );
  }

  let tier: QualityTier = "high";
  let consecutiveBad = 0;
  let consecutiveGood = 0;
  /**
   * Set when the user has asked for reduced motion. The guard then never
   * restores past `reduced`: the preference is a user decision, not a
   * performance measurement, and a fast device must not override it.
   */
  let motionPreferenceCeiling: QualityTier | null = null;

  const setTier = (next: QualityTier) => {
    if (next === tier) return;
    const previous = tier;
    tier = next;
    consecutiveBad = 0;
    consecutiveGood = 0;
    options.onTierChange?.(tier, previous);
  };

  const capToPreference = (candidate: QualityTier): QualityTier => {
    if (!motionPreferenceCeiling) return candidate;
    const candidateRank = TIER_ORDER.indexOf(candidate);
    const ceilingRank = TIER_ORDER.indexOf(motionPreferenceCeiling);
    return candidateRank < ceilingRank ? motionPreferenceCeiling : candidate;
  };

  return {
    getTier: () => tier,

    /** Effects are only worth running at the top tier. */
    animationsEnabled: () => tier === "high",

    /**
     * Feed one FPS sample. Returns the tier after the sample, which may be
     * unchanged.
     */
    sample(fps: number): QualityTier {
      if (!Number.isFinite(fps) || fps <= 0) {
        // A zero or NaN sample means the page was backgrounded or the
        // measurement failed. Neither is evidence about the device, and
        // treating it as catastrophic jank would degrade every tab left in
        // the background.
        return tier;
      }

      if (fps < minimalBelow) {
        consecutiveGood = 0;
        consecutiveBad += 1;
        if (consecutiveBad >= degradeAfter) setTier(capToPreference("minimal"));
        return tier;
      }

      if (fps < degradeBelow) {
        consecutiveGood = 0;
        consecutiveBad += 1;
        if (consecutiveBad >= degradeAfter && tier === "high") {
          setTier(capToPreference("reduced"));
        }
        return tier;
      }

      if (fps > restoreAbove) {
        consecutiveBad = 0;
        consecutiveGood += 1;
        if (consecutiveGood >= restoreAfter && tier !== "high") {
          const target: QualityTier = tier === "minimal" ? "reduced" : "high";
          setTier(capToPreference(target));
        }
        return tier;
      }

      // Between the thresholds: neither bad enough to degrade nor good enough
      // to restore. Reset both runs so the deadband does not accumulate
      // toward a change in either direction.
      consecutiveBad = 0;
      consecutiveGood = 0;
      return tier;
    },

    /**
     * Apply the user's reduced-motion preference. The guard may still degrade
     * further on a slow device, but will never restore above `reduced`.
     */
    setReducedMotionPreference(prefersReducedMotion: boolean) {
      motionPreferenceCeiling = prefersReducedMotion ? "reduced" : null;
      setTier(capToPreference(tier));
    },

    /** Force a tier, for the developer overlay and for tests. */
    override(next: QualityTier) {
      setTier(next);
    },

    reset() {
      consecutiveBad = 0;
      consecutiveGood = 0;
      setTier(capToPreference("high"));
    },
  };
}

/**
 * Reflect the tier onto the document so CSS can switch effects off in one
 * place, rather than every animated component subscribing to a context.
 */
export function applyQualityTierToDocument(tier: QualityTier): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(QUALITY_TIER_ATTRIBUTE, tier);
}
