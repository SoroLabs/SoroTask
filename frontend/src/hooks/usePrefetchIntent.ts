"use client";

/**
 * src/hooks/usePrefetchIntent.ts
 *
 * Hover / focus / touch intent detection for prefetching (Issue #1254).
 *
 * # Why the predictor alone was not enough
 *
 * `usePredictivePrefetch` builds a transition matrix and predicts where the
 * user goes next — but its `prefetchFn` defaulted to `() => {}`, so nothing
 * was ever actually fetched. The prediction was computed and thrown away.
 *
 * This module supplies the other half: the *intent* signal. Frequency
 * prediction is good at "from the dashboard, people usually go to analytics";
 * it knows nothing about the button this particular user is hovering right
 * now. Together they cover both: the predictor warms the likely route on
 * navigation, intent warms the specific one under the cursor.
 *
 * # Why a dwell delay
 *
 * Firing on `mouseenter` prefetches every link a cursor crosses on its way
 * somewhere else — on a dense task list that is dozens of wasted requests and
 * a cache full of pages nobody opened. A short dwell separates "moving past"
 * from "about to click". ~80ms is under the ~200ms it takes to move and click,
 * so the prefetch still lands first.
 *
 * Touch gets no delay: `touchstart` already *is* the commitment, and the
 * window before `click` is the entire budget available.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

/** Milliseconds a pointer must rest on a target before it counts as intent. */
export const DEFAULT_INTENT_DELAY_MS = 80;

export interface PrefetchIntentOptions {
  /** Runs once per target when intent is detected. */
  onIntent: () => void;
  /** Dwell time before hover counts as intent. */
  delayMs?: number;
  /** Set false to disable without changing the call site's hook order. */
  enabled?: boolean;
  /**
   * Re-arm after this long, so a user returning to a link much later gets a
   * fresh prefetch rather than a stale cache entry. `0` means never re-arm.
   */
  rearmAfterMs?: number;
}

/** Props to spread onto the element that should trigger prefetching. */
export interface PrefetchIntentHandlers {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onTouchStart: () => void;
}

/**
 * Returns handlers that fire `onIntent` once the user shows intent.
 *
 * Keyboard focus counts immediately and without a delay — tabbing to a control
 * is deliberate in a way that a cursor crossing it is not, and a keyboard user
 * would otherwise never benefit from prefetching at all.
 */
export function usePrefetchIntent(options: PrefetchIntentOptions): PrefetchIntentHandlers {
  const {
    onIntent,
    delayMs = DEFAULT_INTENT_DELAY_MS,
    enabled = true,
    rearmAfterMs = 60_000,
  } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedAtRef = useRef<number | null>(null);
  // Held in a ref so a caller passing an inline arrow does not re-create every
  // handler on every render.
  const onIntentRef = useRef(onIntent);
  onIntentRef.current = onIntent;

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const alreadyFired = useCallback(() => {
    if (firedAtRef.current === null) return false;
    if (rearmAfterMs === 0) return true;
    return Date.now() - firedAtRef.current < rearmAfterMs;
  }, [rearmAfterMs]);

  const fire = useCallback(() => {
    if (alreadyFired()) return;
    firedAtRef.current = Date.now();
    onIntentRef.current();
  }, [alreadyFired]);

  const arm = useCallback(() => {
    if (!enabled || alreadyFired()) return;
    clear();
    timerRef.current = setTimeout(fire, delayMs);
  }, [enabled, alreadyFired, clear, fire, delayMs]);

  // Leaving before the dwell elapses cancels it — that pointer was passing
  // through, which is exactly the case the delay exists to filter out.
  const disarm = useCallback(() => clear(), [clear]);

  const fireNow = useCallback(() => {
    if (!enabled) return;
    clear();
    fire();
  }, [enabled, clear, fire]);

  useEffect(() => clear, [clear]);

  return useMemo(
    () => ({
      onMouseEnter: arm,
      onMouseLeave: disarm,
      onFocus: fireNow,
      onBlur: disarm,
      onTouchStart: fireNow,
    }),
    [arm, disarm, fireNow],
  );
}
