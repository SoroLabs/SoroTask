import { captureSentryException } from "@/src/lib/errors/sentry";

export interface ThemeTokens {
  background: string;
  foreground: string;
  accent: string;
  surface: string;
}

export interface ThemeEngineOptions {
  fallbackTokens: ThemeTokens;
  externalThemeUrl?: string;
  onError?: (error: Error) => void;
}

export interface ThemeEngineResult {
  usingHoudini: boolean;
  source: "external" | "fallback";
  tokens: ThemeTokens;
}

interface CSSWithRegisterProperty {
  registerProperty?: (definition: {
    name: string;
    syntax?: string;
    inherits?: boolean;
    initialValue?: string;
  }) => void;
}

const PROPERTY_MAP: Record<keyof ThemeTokens, string> = {
  background: "--theme-background",
  foreground: "--theme-foreground",
  accent: "--theme-accent",
  surface: "--theme-surface",
};

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function reportThemeError(error: Error, onError?: (error: Error) => void) {
  captureSentryException(error, {
    section: "houdini-theme-engine",
  });
  onError?.(error);
}

function getCssApi(): CSSWithRegisterProperty | null {
  if (typeof window === "undefined" || typeof window.CSS === "undefined") {
    return null;
  }

  return window.CSS as unknown as CSSWithRegisterProperty;
}

export function isHoudiniSupported(): boolean {
  const css = getCssApi();
  return Boolean(css && typeof css.registerProperty === "function");
}

export function registerThemeProperties(): boolean {
  const css = getCssApi();
  if (!css || typeof css.registerProperty !== "function") {
    return false;
  }

  try {
    css.registerProperty({
      name: PROPERTY_MAP.background,
      syntax: "<color>",
      inherits: true,
      initialValue: "#0f172a",
    });
    css.registerProperty({
      name: PROPERTY_MAP.foreground,
      syntax: "<color>",
      inherits: true,
      initialValue: "#f8fafc",
    });
    css.registerProperty({
      name: PROPERTY_MAP.accent,
      syntax: "<color>",
      inherits: true,
      initialValue: "#2563eb",
    });
    css.registerProperty({
      name: PROPERTY_MAP.surface,
      syntax: "<color>",
      inherits: true,
      initialValue: "#1e293b",
    });
    return true;
  } catch {
    return true;
  }
}

export function applyThemeTokens(tokens: ThemeTokens) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.style.setProperty(PROPERTY_MAP.background, tokens.background);
  root.style.setProperty(PROPERTY_MAP.foreground, tokens.foreground);
  root.style.setProperty(PROPERTY_MAP.accent, tokens.accent);
  root.style.setProperty(PROPERTY_MAP.surface, tokens.surface);

  // Degradation path using standard CSS variables.
  root.style.setProperty("--fallback-bg", tokens.background);
  root.style.setProperty("--fallback-fg", tokens.foreground);
  root.style.setProperty("--fallback-accent", tokens.accent);
  root.style.setProperty("--fallback-surface", tokens.surface);
}

export async function fetchExternalTheme(
  url: string,
  timeoutMs = 2500,
): Promise<ThemeTokens> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Theme fetch failed with status ${response.status}`);
    }

    const data = (await response.json()) as Partial<ThemeTokens>;
    if (
      !data ||
      typeof data.background !== "string" ||
      typeof data.foreground !== "string" ||
      typeof data.accent !== "string" ||
      typeof data.surface !== "string"
    ) {
      throw new Error("Theme payload is invalid.");
    }

    return {
      background: data.background,
      foreground: data.foreground,
      accent: data.accent,
      surface: data.surface,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function initHoudiniThemeEngine(
  options: ThemeEngineOptions,
): Promise<ThemeEngineResult> {
  const usingHoudini = registerThemeProperties();

  if (options.externalThemeUrl) {
    try {
      const external = await fetchExternalTheme(options.externalThemeUrl);
      applyThemeTokens(external);
      return {
        usingHoudini,
        source: "external",
        tokens: external,
      };
    } catch (error) {
      reportThemeError(normalizeError(error), options.onError);
    }
  }

  applyThemeTokens(options.fallbackTokens);
  return {
    usingHoudini,
    source: "fallback",
    tokens: options.fallbackTokens,
  };
}
