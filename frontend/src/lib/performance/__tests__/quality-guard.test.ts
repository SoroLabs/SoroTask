import {
  applyQualityTierToDocument,
  createQualityGuard,
  DEFAULT_DEGRADE_BELOW_FPS,
  DEFAULT_RESTORE_ABOVE_FPS,
  QUALITY_TIER_ATTRIBUTE,
} from "../quality-guard";

/**
 * Quality guard (Issue #1253).
 *
 * The behaviour that matters is not "does it degrade" but "does it stay
 * degraded sensibly" — a guard that flips tiers every second is worse than no
 * guard, so the hysteresis and the sample runs are what these pin.
 */

/** Feed the same FPS n times. */
function feed(guard: ReturnType<typeof createQualityGuard>, fps: number, times: number) {
  for (let i = 0; i < times; i += 1) guard.sample(fps);
}

describe("createQualityGuard", () => {
  it("starts at full quality with animations enabled", () => {
    const guard = createQualityGuard();
    expect(guard.getTier()).toBe("high");
    expect(guard.animationsEnabled()).toBe(true);
  });

  it("does not degrade on a single slow sample", () => {
    const guard = createQualityGuard();
    guard.sample(20);
    // One bad second is a route transition or a GC pause, not a slow device.
    expect(guard.getTier()).toBe("high");
  });

  it("degrades after sustained frame rate below the threshold", () => {
    const guard = createQualityGuard({ degradeAfterSamples: 3 });
    feed(guard, DEFAULT_DEGRADE_BELOW_FPS - 5, 3);
    expect(guard.getTier()).toBe("reduced");
    expect(guard.animationsEnabled()).toBe(false);
  });

  it("drops to minimal when frame rate is very low", () => {
    const guard = createQualityGuard({ degradeAfterSamples: 3 });
    feed(guard, 10, 3);
    expect(guard.getTier()).toBe("minimal");
  });

  it("resets the bad run when a good sample arrives", () => {
    const guard = createQualityGuard({ degradeAfterSamples: 3 });
    guard.sample(30);
    guard.sample(30);
    guard.sample(60);
    guard.sample(30);
    // The run restarted, so three total bad samples are not three consecutive.
    expect(guard.getTier()).toBe("high");
  });

  it("does not restore at the degrade threshold", () => {
    // The asymmetry is the whole point: restoring at the same frame rate that
    // triggered degradation oscillates, because degrading raises the frame
    // rate and immediately re-qualifies the device.
    const guard = createQualityGuard({ degradeAfterSamples: 2, restoreAfterSamples: 2 });
    feed(guard, 30, 2);
    expect(guard.getTier()).toBe("reduced");

    feed(guard, DEFAULT_DEGRADE_BELOW_FPS + 1, 10);
    expect(guard.getTier()).toBe("reduced");
  });

  it("restores one tier at a time once frame rate is clearly better", () => {
    const guard = createQualityGuard({ degradeAfterSamples: 2, restoreAfterSamples: 2 });
    feed(guard, 10, 2);
    expect(guard.getTier()).toBe("minimal");

    feed(guard, DEFAULT_RESTORE_ABOVE_FPS + 5, 2);
    expect(guard.getTier()).toBe("reduced");

    feed(guard, DEFAULT_RESTORE_ABOVE_FPS + 5, 2);
    expect(guard.getTier()).toBe("high");
  });

  it("ignores zero and non-finite samples", () => {
    // A backgrounded tab reports no frames. Treating that as catastrophic
    // jank would degrade every tab the user is not looking at.
    const guard = createQualityGuard({ degradeAfterSamples: 2 });
    guard.sample(0);
    guard.sample(Number.NaN);
    guard.sample(0);
    expect(guard.getTier()).toBe("high");
  });

  it("notifies on tier change, once per change", () => {
    const onTierChange = jest.fn();
    const guard = createQualityGuard({ degradeAfterSamples: 2, onTierChange });

    feed(guard, 30, 2);
    expect(onTierChange).toHaveBeenCalledTimes(1);
    expect(onTierChange).toHaveBeenCalledWith("reduced", "high");

    feed(guard, 30, 5);
    expect(onTierChange).toHaveBeenCalledTimes(1);
  });

  it("never restores past reduced while reduced motion is preferred", () => {
    const guard = createQualityGuard({ degradeAfterSamples: 2, restoreAfterSamples: 2 });
    guard.setReducedMotionPreference(true);
    expect(guard.getTier()).toBe("reduced");

    feed(guard, 120, 10);
    // The preference is a user decision; a fast device must not override it.
    expect(guard.getTier()).toBe("reduced");

    guard.setReducedMotionPreference(false);
    feed(guard, 120, 2);
    expect(guard.getTier()).toBe("high");
  });

  it("still degrades below the preference ceiling on a slow device", () => {
    const guard = createQualityGuard({ degradeAfterSamples: 2 });
    guard.setReducedMotionPreference(true);
    feed(guard, 10, 2);
    expect(guard.getTier()).toBe("minimal");
  });

  it("rejects a restore threshold that would oscillate", () => {
    expect(() =>
      createQualityGuard({ degradeBelowFps: 45, restoreAboveFps: 45 }),
    ).toThrow(/greater than/);
  });

  it("reflects the tier onto the document element", () => {
    applyQualityTierToDocument("minimal");
    expect(document.documentElement.getAttribute(QUALITY_TIER_ATTRIBUTE)).toBe("minimal");
  });
});
