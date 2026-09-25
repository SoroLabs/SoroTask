/**
 * The pre-paint script is the whole mechanism behind "zero theme flash" (#1241),
 * so its behaviour is asserted directly rather than assumed.
 */

import { THEME_INIT_SCRIPT } from "@/app/theme-init";
import {
  SYSTEM_DARK_QUERY,
  THEME_MODES,
  THEME_STORAGE_KEY,
} from "@/src/lib/theme/themeEngine";

type Parsed = { mode: string; resolved: string; colorScheme: string };

/** Evaluates the inline script against a fake localStorage / matchMedia. */
function runScript(stored: string | null, prefersDark: boolean): Parsed {
  const root = document.documentElement;
  root.removeAttribute("data-theme");
  root.removeAttribute("data-theme-mode");
  root.style.removeProperty("color-scheme");

  const localStorageStub = stored === null ? null : { getItem: () => stored };
  const matchMediaStub = (query: string) => ({
    matches: query === SYSTEM_DARK_QUERY ? prefersDark : false,
  });

  const previousStorage = Object.getOwnPropertyDescriptor(
    window,
    "localStorage",
  );
  const previousMatchMedia = window.matchMedia;

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () =>
      localStorageStub ?? {
        getItem: () => {
          throw new Error("SecurityError");
        },
      },
  });
  window.matchMedia = matchMediaStub as unknown as typeof window.matchMedia;

  try {
    // eslint-disable-next-line no-new-func
    new Function(THEME_INIT_SCRIPT)();
  } finally {
    if (previousStorage)
      Object.defineProperty(window, "localStorage", previousStorage);
    window.matchMedia = previousMatchMedia;
  }

  return {
    mode: root.getAttribute("data-theme-mode") ?? "",
    resolved: root.getAttribute("data-theme") ?? "",
    colorScheme: root.style.colorScheme,
  };
}

describe("pre-paint theme script", () => {
  it("resolves system against the OS dark preference", () => {
    expect(runScript(null, true)).toMatchObject({
      mode: "system",
      resolved: "dark",
    });
    expect(runScript(null, false)).toMatchObject({
      mode: "system",
      resolved: "light",
    });
  });

  it("honours an explicit stored preference over the OS", () => {
    expect(runScript("oled", false)).toMatchObject({
      mode: "oled",
      resolved: "oled",
    });
    expect(runScript("light", true)).toMatchObject({
      mode: "light",
      resolved: "light",
    });
  });

  it("records the preference separately from the resolved theme", () => {
    // `system` must survive so the toggle can show what the user picked rather
    // than silently rewriting their choice to the resolved value.
    const parsed = runScript("system", true);
    expect(parsed.mode).toBe("system");
    expect(parsed.resolved).toBe("dark");
  });

  it("falls back to system for an unrecognised stored value", () => {
    expect(runScript("solarized", true).mode).toBe("system");
  });

  it("sets color-scheme so form controls and scrollbars match", () => {
    expect(runScript("light", false).colorScheme).toBe("light");
    expect(runScript("dark", false).colorScheme).toBe("dark");
    // OLED is a dark surface even though it is not the OS preference.
    expect(runScript("oled", false).colorScheme).toBe("dark");
  });

  it("survives a localStorage read that throws", () => {
    // Private-mode Safari throws on access; the script must not abort the
    // parser before the app renders.
    const parsed = runScript(null, true);
    expect(parsed.resolved).toBe("dark");
  });

  it("agrees with the canonical mode list", () => {
    // Guards against the inline guard drifting from THEME_MODES.
    for (const mode of THEME_MODES) {
      expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(mode));
    }
  });

  it("uses the same storage key as next-themes", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it("is synchronous and self-contained", () => {
    // No imports, no fetch, no await: it has to finish before first paint.
    expect(THEME_INIT_SCRIPT).not.toMatch(/\bimport\b|\bfetch\(|await |async /);
  });
});
