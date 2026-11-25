/**
 * Development-only slow render reporting (Issue #1253).
 *
 * The profiler reports that the main thread was blocked; it does not say which
 * component blocked it. React's Profiler `onRender` callback does, so this
 * turns an actual commit duration into a named warning a developer can act on
 * without opening the performance panel.
 *
 * Production builds never call this — the Profiler wrapper is stripped — so the
 * cost is a development concern only.
 */

export type RenderRecord = {
  component: string;
  phase: "mount" | "update" | "nested-update";
  actualDurationMs: number;
  baseDurationMs: number;
  at: string;
};

/**
 * One frame at 60fps is 16.67ms. A commit above this leaves nothing for
 * style, layout and paint, so it is the point at which a render is the reason
 * a frame was missed rather than a contributor to it.
 */
export const SLOW_RENDER_THRESHOLD_MS = 16;

/** Repeat warnings for the same component are throttled to this interval. */
const WARN_THROTTLE_MS = 5_000;

const lastWarnedAt = new Map<string, number>();
const records: RenderRecord[] = [];
const MAX_RECORDS = 100;

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Record a commit and warn if it was slow.
 *
 * Returns the record when one was kept, or null when the call was ignored
 * (production, or a fast render).
 */
export function recordRender(
  component: string,
  phase: RenderRecord["phase"],
  actualDurationMs: number,
  baseDurationMs: number,
  thresholdMs: number = SLOW_RENDER_THRESHOLD_MS,
  now: number = Date.now(),
): RenderRecord | null {
  if (!isDevelopment()) return null;
  if (actualDurationMs < thresholdMs) return null;

  const record: RenderRecord = {
    component,
    phase,
    actualDurationMs: Number(actualDurationMs.toFixed(2)),
    baseDurationMs: Number(baseDurationMs.toFixed(2)),
    at: new Date(now).toISOString(),
  };

  records.unshift(record);
  records.length = Math.min(records.length, MAX_RECORDS);

  // Throttled per component: a list re-rendering on every keystroke would
  // otherwise bury every other warning in the console.
  const previous = lastWarnedAt.get(component) ?? 0;
  if (now - previous >= WARN_THROTTLE_MS) {
    lastWarnedAt.set(component, now);
    console.warn(
      `[render] ${component} ${phase} took ${record.actualDurationMs}ms ` +
        `(threshold ${thresholdMs}ms). A commit this long cannot fit in a 60fps frame.`,
    );
  }

  return record;
}

export function getRenderRecords(): RenderRecord[] {
  return [...records];
}

export function resetRenderRecords(): void {
  records.length = 0;
  lastWarnedAt.clear();
}
