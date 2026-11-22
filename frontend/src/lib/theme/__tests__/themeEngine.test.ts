/**
 * Asserts the theme token sets actually meet WCAG contrast (#1241).
 *
 * The acceptance criterion for the OLED theme is "passes contrast ratio
 * checks". Encoding the ratios here makes that a property the suite enforces,
 * and — just as importantly — fails loudly if someone edits a hex value in
 * `app/globals.css` without updating the mirror in `themeEngine.ts`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  THEME_MODES,
  THEME_TOKENS,
  WCAG_AA_LARGE_TEXT,
  WCAG_AA_TEXT,
  WCAG_AAA_TEXT,
  contrastRatio,
  meetsContrast,
  relativeLuminance,
  resolveTheme,
  isThemeMode,
  themeFromColorScheme,
  DEFAULT_THEME_MODE,
} from "../themeEngine";

/**
 * Reads a `--token` declaration out of a named CSS block and returns its colour.
 *
 * `--background` and `--foreground` delegate through the Houdini indirection
 * (`var(--theme-background, var(--fallback-bg, #ffffff))`), so for those the
 * value to compare is the innermost fallback — the colour a browser with no
 * Houdini support and no runtime theme actually paints.
 */
function cssVar(block: string, name: string): string {
  const declaration = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!declaration) throw new Error(`globals.css is missing --${name}`);

  const hexes = declaration[1].match(/#[0-9a-fA-F]{3,6}/g);
  if (!hexes) throw new Error(`--${name} does not resolve to a literal colour`);

  return hexes[hexes.length - 1];
}

function readGlobalsCss(): string {
  return readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
}

/**
 * Extracts the body of a `[data-theme="..."] { ... }` rule.
 *
 * Comments are stripped first: the documentation block above the tokens
 * mentions the selectors by name, and a naive `indexOf` would match the prose
 * and then read the *next* rule as if it were the theme block.
 */
function themeBlock(css: string, selector: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{`);
  const match = withoutComments.match(pattern);
  if (!match || match.index === undefined) {
    throw new Error(`globals.css is missing the ${selector} block`);
  }

  const open = withoutComments.indexOf("{", match.index);
  const close = withoutComments.indexOf("}", open);
  return withoutComments.slice(open + 1, close);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("theme token contrast", () => {
  const textSurfaces = ["background", "surface", "elevated"] as const;
  const textTokens = ["textPrimary", "textSecondary", "textMuted"] as const;

  it.each(Object.keys(THEME_TOKENS) as Array<keyof typeof THEME_TOKENS>)(
    "%s keeps every body-text pair at or above WCAG AA",
    (theme) => {
      const tokens = THEME_TOKENS[theme];
      for (const surface of textSurfaces) {
        for (const text of textTokens) {
          const ratio = contrastRatio(tokens[text], tokens[surface]);
          expect({
            theme,
            text,
            surface,
            ratio: Number(ratio.toFixed(2)),
          }).toMatchObject({
            ratio: expect.any(Number),
          });
          expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
        }
      }
    },
  );

  it("holds the OLED theme to AAA for all three text tokens", () => {
    const tokens = THEME_TOKENS.oled;
    for (const surface of textSurfaces) {
      for (const text of textTokens) {
        const ratio = contrastRatio(tokens[text], tokens[surface]);
        expect({ text, surface, ratio: Number(ratio.toFixed(2)) }).toBeTruthy();
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA_TEXT);
      }
    }
  });

  it("keeps form-control edges at or above the 3:1 UI-component threshold", () => {
    // WCAG 1.4.11 applies to boundaries needed to *identify a control*. A form
    // input is the clearest case, so its edge must be locatable against every
    // surface it can sit on. Decorative hairlines (`border`, `borderSubtle`)
    // are out of scope for that criterion and are deliberately not asserted —
    // holding a card separator to 3:1 would flatten the whole surface hierarchy.
    for (const theme of Object.keys(THEME_TOKENS) as Array<
      keyof typeof THEME_TOKENS
    >) {
      const tokens = THEME_TOKENS[theme];
      for (const surface of textSurfaces) {
        const ratio = contrastRatio(tokens.inputBorder, tokens[surface]);
        expect({
          theme,
          surface,
          ratio: Number(ratio.toFixed(2)),
        }).toBeTruthy();
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE_TEXT);
      }
    }
  });

  it("keeps the input edge distinguishable from the surface it sits on", () => {
    // A guard against "passes 3:1 against white but is invisible on --bg-base".
    for (const theme of Object.keys(THEME_TOKENS) as Array<
      keyof typeof THEME_TOKENS
    >) {
      const tokens = THEME_TOKENS[theme];
      expect(
        contrastRatio(tokens.inputBorder, tokens.background),
      ).toBeGreaterThan(
        contrastRatio(tokens.inputBorder, tokens.elevated) - 0.001,
      );
    }
  });

  it("keeps status colours readable on the base background", () => {
    for (const theme of Object.keys(THEME_TOKENS) as Array<
      keyof typeof THEME_TOKENS
    >) {
      const tokens = THEME_TOKENS[theme];
      for (const status of ["success", "warning", "error"] as const) {
        expect(
          contrastRatio(tokens[status], tokens.background),
        ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      }
    }
  });

  it("keeps accent text readable on the accent fill", () => {
    for (const theme of Object.keys(THEME_TOKENS) as Array<
      keyof typeof THEME_TOKENS
    >) {
      const tokens = THEME_TOKENS[theme];
      expect(
        contrastRatio(tokens.accentForeground, tokens.accent),
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    }
  });
});

describe("contrast maths", () => {
  it("returns 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#3b82f6", "#3b82f6")).toBeCloseTo(1, 5);
  });

  it("is symmetric in its arguments", () => {
    expect(contrastRatio("#171717", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#171717"),
      10,
    );
  });

  it("expands 3-digit hex", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(
      relativeLuminance("#ffffff"),
      10,
    );
  });

  it("rejects a malformed colour", () => {
    expect(() => relativeLuminance("rebeccapurple")).toThrow(/Expected a #RGB/);
  });

  it("reports the threshold as inclusive", () => {
    expect(meetsContrast("#000000", "#ffffff", WCAG_AA_TEXT)).toBe(true);
    expect(meetsContrast("#777777", "#ffffff", WCAG_AA_TEXT)).toBe(false);
  });
});

describe("theme resolution", () => {
  it("exposes exactly the four user-selectable modes", () => {
    expect([...THEME_MODES]).toEqual(["light", "dark", "oled", "system"]);
    expect(DEFAULT_THEME_MODE).toBe("system");
  });

  it("resolves system against the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("passes explicit modes through untouched", () => {
    expect(resolveTheme("oled", false)).toBe("oled");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("never resolves the system preference to oled", () => {
    expect(themeFromColorScheme(true)).toBe("dark");
    expect(themeFromColorScheme(false)).toBe("light");
  });

  it("validates stored values", () => {
    expect(isThemeMode("oled")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("solarized")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });
});

describe("globals.css stays in sync with the token table", () => {
  const css = readGlobalsCss();

  it("defines a block for every theme, including light", () => {
    // The regression that motivated #1241: light mode had no token block.
    expect(css).toContain(':root,\n[data-theme="light"]');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('[data-theme="oled"]');
  });

  it("declares color-scheme per theme so form controls follow suit", () => {
    expect(themeBlock(css, '[data-theme="light"]')).toContain(
      "color-scheme: light",
    );
    expect(themeBlock(css, '[data-theme="dark"]')).toContain(
      "color-scheme: dark",
    );
    expect(themeBlock(css, '[data-theme="oled"]')).toContain(
      "color-scheme: dark",
    );
  });

  const cssNameByToken: Array<[keyof (typeof THEME_TOKENS)["light"], string]> =
    [
      ["background", "background"],
      ["surface", "bg-surface"],
      ["elevated", "bg-elevated"],
      ["textPrimary", "text-primary"],
      ["textSecondary", "text-secondary"],
      ["textMuted", "text-muted"],
      ["border", "border"],
      ["inputBorder", "input-border"],
      ["accent", "accent"],
      ["accentForeground", "accent-foreground"],
    ];

  it.each(Object.keys(THEME_TOKENS) as Array<keyof typeof THEME_TOKENS>)(
    "%s mirrors the TypeScript token values exactly",
    (theme) => {
      const block =
        theme === "light"
          ? themeBlock(css, ':root,\n[data-theme="light"]')
          : themeBlock(css, `[data-theme="${theme}"]`);

      for (const [token, cssName] of cssNameByToken) {
        // `background` and `foreground` in :root resolve through the Houdini
        // indirection, so compare against the fallback they delegate to.
        const fromCss = cssVar(block, cssName);
        expect({
          theme,
          token,
          fromCss,
          fromTs: THEME_TOKENS[theme][token],
        }).toBeTruthy();
        expect(fromCss.toLowerCase()).toBe(
          THEME_TOKENS[theme][token].toLowerCase(),
        );
      }
    },
  );
});
