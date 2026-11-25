/**
 * Accessibility test harness.
 *
 * Shared helpers for the axe-core sweeps and contrast checks, so the individual
 * test files describe *what* is being audited rather than re-deriving the rules
 * each time.
 *
 * The contrast maths is the WCAG 2.1 relative-luminance definition
 * (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance), implemented here
 * rather than pulled from a dependency so it can be tested against the
 * published reference values.
 */

import { axe } from 'jest-axe';
// The result type lives in axe-core, which jest-axe depends on but does not
// re-export. The options type is derived from `axe` itself: jest-axe and
// axe-core each declare their own `RunOptions`, and picking the wrong one makes
// a structurally identical object fail to typecheck.
import type { AxeResults } from 'axe-core';

export { axe };
export type { AxeResults };

/** Options accepted by `axe`, as declared by jest-axe. */
export type AxeRunOptions = NonNullable<Parameters<typeof axe>[1]>;

/** Minimum contrast for normal-size body text (WCAG 2.1 AA, 1.4.3). */
export const AA_TEXT_CONTRAST = 4.5;

/** Minimum contrast for large text: >=18pt, or >=14pt when bold. */
export const AA_LARGE_TEXT_CONTRAST = 3;

/**
 * Rules to enforce in CI.
 *
 * `region` is left enabled deliberately: it is the rule that catches content
 * sitting outside any landmark, which is the most common way a screen-reader
 * user loses the shape of a page. `color-contrast` is kept for its reporting
 * value even though jsdom cannot compute it, because axe skips it there rather
 * than failing.
 */
export const DEFAULT_AXE_OPTIONS: AxeRunOptions = {
  rules: {
    // The palette and modals are legitimate uses of a dialog surface.
    'color-contrast-enhanced': { enabled: false },
  },
};

export interface ViolationSummary {
  id: string;
  impact: string | null;
  help: string;
  /** Concise description of what failed and why, for assertion messages. */
  describe: () => string;
}

/**
 * Run axe and reduce the result to something assertable and readable.
 *
 * Returning the full `AxeResults` in a Jest failure produces hundreds of lines
 * of DOM, which is the least useful thing a test runner can print. This keeps
 * the rule id, impact and help text, and joins the failing nodes.
 */
export async function auditViolations(
  container: Element,
  options: AxeRunOptions = {},
): Promise<ViolationSummary[]> {
  const results = await axe(container, { ...DEFAULT_AXE_OPTIONS, ...options });

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    describe: () =>
      `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n` +
      violation.nodes.map((node) => `  - ${node.target.join(' ')}`).join('\n'),
  }));
}

/** True when axe found nothing at all. */
export async function hasNoViolations(
  container: Element,
  options: AxeRunOptions = {},
): Promise<{ clean: boolean; summary: string }> {
  const violations = await auditViolations(container, options);
  return {
    clean: violations.length === 0,
    summary:
      violations.length === 0
        ? 'no violations'
        : violations.map((v) => v.describe()).join('\n\n'),
  };
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a CSS colour into 8-bit channels.
 *
 * Handles `#rgb`, `#rrggbb` and `rgb()` / `rgba()` in both comma and space
 * syntax. Returns null for anything it cannot read, because a test that
 * silently treats an unparseable colour as transparent would report a
 * meaningless contrast figure.
 */
export function parseColor(input: string): Rgb | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();

  if (value === 'transparent') return { r: 0, g: 0, b: 0 };

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3) {
      return {
        r: parseInt(digits[0] + digits[0], 16),
        g: parseInt(digits[1] + digits[1], 16),
        b: parseInt(digits[2] + digits[2], 16),
      };
    }
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    };
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (raw: string) => {
      const n = raw.endsWith('%') ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
      return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : null;
    };
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    if (r === null || g === null || b === null) return null;
    return { r, g, b };
  }

  return null;
}

/** Linearise one 8-bit channel per WCAG 2.1. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, in [0, 1]. */
export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * linearise(color.r) + 0.7152 * linearise(color.g) + 0.0722 * linearise(color.b)
  );
}

/** WCAG 2.1 contrast ratio between two colours, in [1, 21]. */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;

  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when a ratio clears the AA threshold for the given text size. */
export function meetsAA(ratio: number, isLargeText = false): boolean {
  return ratio >= (isLargeText ? AA_LARGE_TEXT_CONTRAST : AA_TEXT_CONTRAST);
}
