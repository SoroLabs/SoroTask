import {
  applyThemeTokens,
  fetchExternalTheme,
  initHoudiniThemeEngine,
  isHoudiniSupported,
  registerThemeProperties,
  type ThemeTokens,
} from "../houdiniThemeEngine";

const fallback: ThemeTokens = {
  background: "#0f172a",
  foreground: "#f8fafc",
  accent: "#2563eb",
  surface: "#1e293b",
};

describe("houdiniThemeEngine", () => {
  const originalFetch = global.fetch;
  const originalCSS = global.CSS;

  afterEach(() => {
    global.fetch = originalFetch;
    // @ts-expect-error test reset
    global.CSS = originalCSS;
    jest.clearAllMocks();
  });

  it("detects Houdini support", () => {
    // @ts-expect-error test override
    global.CSS = { registerProperty: jest.fn() };
    expect(isHoudiniSupported()).toBe(true);
  });

  it("returns false when Houdini is unavailable", () => {
    // @ts-expect-error test override
    global.CSS = {};
    expect(isHoudiniSupported()).toBe(false);
  });

  it("registers custom properties when supported", () => {
    const registerProperty = jest.fn();
    // @ts-expect-error test override
    global.CSS = { registerProperty };

    expect(registerThemeProperties()).toBe(true);
    expect(registerProperty).toHaveBeenCalled();
  });

  it("applies both Houdini and fallback variables", () => {
    applyThemeTokens(fallback);
    const style = document.documentElement.style;

    expect(style.getPropertyValue("--theme-background")).toBe(fallback.background);
    expect(style.getPropertyValue("--fallback-bg")).toBe(fallback.background);
  });

  it("fetches and validates external theme tokens", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        background: "#111111",
        foreground: "#eeeeee",
        accent: "#ff5500",
        surface: "#222222",
      }),
    })) as unknown as typeof fetch;

    await expect(fetchExternalTheme("/api/theme")).resolves.toEqual({
      background: "#111111",
      foreground: "#eeeeee",
      accent: "#ff5500",
      surface: "#222222",
    });
  });

  it("falls back when external theme retrieval fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const onError = jest.fn();
    const result = await initHoudiniThemeEngine({
      fallbackTokens: fallback,
      externalThemeUrl: "/api/theme",
      onError,
    });

    expect(result.source).toBe("fallback");
    expect(onError).toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--fallback-bg")).toBe(
      fallback.background,
    );
  });

  it("uses external theme when available", async () => {
    // @ts-expect-error test override
    global.CSS = { registerProperty: jest.fn() };
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        background: "#121212",
        foreground: "#f1f5f9",
        accent: "#22c55e",
        surface: "#1f2937",
      }),
    })) as unknown as typeof fetch;

    const result = await initHoudiniThemeEngine({
      fallbackTokens: fallback,
      externalThemeUrl: "/api/theme",
    });

    expect(result.source).toBe("external");
    expect(result.usingHoudini).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--theme-accent")).toBe(
      "#22c55e",
    );
  });
});
