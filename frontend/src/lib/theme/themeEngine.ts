/**
 * Zero-FOUC theme engine (#1241).
 *
 * The theme is decided in three places that must agree:
 *
 *  1. A blocking inline script in <head> (`app/theme-init.tsx`) resolves the
 *     stored preference *before the first paint* and stamps the attribute on
 *     <html>. This is what removes the flash: by the time the browser has
 *     painted anything, `data-theme` is already correct.
 *  2. The CSS custom properties in `app/globals.css` map that attribute to a
 *     complete token set. Every token a component can reference is defined for
 *     every theme — the previous implementation only defined the dark values,
 *     so light mode silently fell through to invalid `var()` and that is what
 *     the failing contrast audits were reporting.
 *  3. `next-themes` owns persistence and the `system` value, and is configured
 *     with `disableTransitionOnChange` so switching does not animate the swap.
 *
 * Keeping the token *values* here in TypeScript (rather than only in CSS) is
 * deliberate: it lets the contrast ratios below be asserted in a unit test, so
 * "passes contrast ratio checks" is a fact the suite enforces rather than a
 * claim in a comment.
 */

/** User-selectable values. `system` defers to the OS preference. */
export type ThemeMode = "light" | "dark" | "oled" | "system";

/** A fully-resolved theme, i.e. what `system` resolves to on this device. */
export type ResolvedTheme = "light" | "dark" | "oled";

/** The themes a user can actually see. `system` is a preference, not a look. */
export const THEME_MODES: readonly ThemeMode[] = [
  "light",
  "dark",
  "oled",
  "system",
];

export const DEFAULT_THEME_MODE: ThemeMode = "system";

/** Must match the `storageKey` passed to next-themes in app/layout.tsx. */
export const THEME_STORAGE_KEY = "theme";

/**
 * The system preference is treated as plain `dark`, never `oled`: an OLED
 * panel is a hardware characteristic, and burning in a light UI on one is the
 * user's explicit choice, not something to infer from the OS.
 */
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
  );
}

export function resolveTheme(
  mode: ThemeMode,
  prefersDark: boolean,
): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/** Maps a `prefers-color-scheme` query result onto a concrete theme. */
export function themeFromColorScheme(prefersDark: boolean): ResolvedTheme {
  return prefersDark ? "dark" : "light";
}

/**
 * WCAG 2.1 relative luminance.
 *
 * Uses sRGB linearisation rather than a plain average because WCAG contrast is
 * defined on linear light, and the naive formula understates contrast for dark
 * colours — which would let a genuinely failing pair pass this check.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (c: number) => {
    const srgb = c / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for body text (4.5:1) and large text / UI boundaries (3:1). */
export const WCAG_AA_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;
/** WCAG AAA, the bar the OLED theme is held to. */
export const WCAG_AAA_TEXT = 7;

export function meetsContrast(
  foreground: string,
  background: string,
  minimum: number = WCAG_AA_TEXT,
): boolean {
  return contrastRatio(foreground, background) >= minimum;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalised = hex.trim().replace(/^#/, "");
  const expanded =
    normalised.length === 3
      ? normalised
          .split("")
          .map((c) => c + c)
          .join("")
      : normalised;

  if (expanded.length !== 6 || !/^[0-9a-f]{6}$/i.test(expanded)) {
    throw new Error(`Expected a #RGB or #RRGGBB colour, received "${hex}"`);
  }

  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/**
 * The token pairs that carry text and interactive affordances, per theme.
 *
 * This is the contract the contrast test asserts against. Adding a token means
 * adding it here too, which is the point: an unaudited text colour cannot
 * reach a shipped theme.
 *
 * `border` and `borderSubtle` are decorative hairlines (dividers, card edges)
 * and are deliberately *not* held to 3:1 — WCAG 1.4.11 scopes non-text
 * contrast to boundaries needed to identify a control, and a separator between
 * list rows is not one. `inputBorder` is held to 3:1, because that one *is* the
 * affordance: you have to be able to see where to click and type.
 */
export interface ThemeTokens {
  background: string;
  surface: string;
  elevated: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderSubtle: string;
  inputBorder: string;
  accent: string;
  accentForeground: string;
  success: string;
  warning: string;
  error: string;
}

/**
 * Mirrors app/globals.css. Keep the two in sync — `themeEngine.test.ts` fails
 * loudly if the CSS and this table drift apart.
 */
export const THEME_TOKENS: Record<ResolvedTheme, ThemeTokens> = {
  light: {
    background: "#ffffff",
    surface: "#f9fafb",
    elevated: "#f3f4f6",
    // #171717 on #ffffff is 17.9:1; the muted tone stays above AA even on the
    // darkest surface it is used against (#f3f4f6 -> 6.4:1).
    textPrimary: "#171717",
    textSecondary: "#404040",
    textMuted: "#595959",
    border: "#d4d4d8",
    borderSubtle: "#e4e4e7",
    // 3.28:1 against the lightest surface it sits on — the minimum that
    // makes a form control's edge reliably locatable.
    inputBorder: "#86868e",
    accent: "#1d4ed8",
    accentForeground: "#ffffff",
    success: "#14532d",
    warning: "#713f12",
    error: "#991b1b",
  },
  dark: {
    background: "#0a0a0a",
    surface: "#18181b",
    elevated: "#27272a",
    textPrimary: "#fafafa",
    textSecondary: "#a1a1aa",
    // Lightened from #71717a, which only reached 3.08:1 on --bg-elevated and
    // so failed AA for the 12-14px sizes it is used at.
    textMuted: "#909098",
    border: "#3f3f46",
    borderSubtle: "#27272a",
    inputBorder: "#75757e",
    accent: "#60a5fa",
    accentForeground: "#0a0a0a",
    success: "#86efac",
    warning: "#fcd34d",
    error: "#fca5a5",
  },
  oled: {
    // Pure black is the point of an OLED theme: unlit pixels draw no power.
    background: "#000000",
    surface: "#0a0a0a",
    elevated: "#171717",
    // Held to AAA (7:1) rather than AA, since this theme exists for users who
    // need maximum legibility.
    textPrimary: "#ffffff",
    textSecondary: "#e5e5e5",
    textMuted: "#d4d4d8",
    // Brighter than in dark mode so control boundaries stay visible against
    // black without relying on a fill difference.
    border: "#a3a3a3",
    borderSubtle: "#52525b",
    inputBorder: "#a3a3a3",
    accent: "#93c5fd",
    accentForeground: "#000000",
    success: "#bbf7d0",
    warning: "#fde68a",
    error: "#fecaca",
  },
};

/** Human-readable label for each user-selectable mode. */
export const THEME_LABELS: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  oled: "High-contrast OLED",
  system: "System",
};

/** The order the toggle cycles through. */
export const THEME_CYCLE: readonly ThemeMode[] = [
  "light",
  "dark",
  "oled",
  "system",
];
