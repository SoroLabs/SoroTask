"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { initHoudiniThemeEngine } from "@/src/lib/theme/houdiniThemeEngine";

export type ThemeMode = "light" | "dark" | "system" | "high-contrast";

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  setMode: () => {},
});

const THEME_STORAGE_KEY = "theme";

function isThemeMode(value: unknown): value is ThemeMode {
  return (
    value === "light" ||
    value === "dark" ||
    value === "system" ||
    value === "high-contrast"
  );
}

function resolveTheme(mode: ThemeMode): Exclude<ThemeMode, "system"> {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");

  const applyTheme = useCallback((nextMode: ThemeMode) => {
    document.documentElement.setAttribute("data-theme", resolveTheme(nextMode));
  }, []);

  // Hydrate from localStorage once on mount. An unusable stored value falls
  // back to the system preference rather than leaving the document unthemed.
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    const nextMode = isThemeMode(saved) ? saved : "system";
    setModeState(nextMode);
    applyTheme(nextMode);
  }, [applyTheme]);

  useEffect(() => {
    void initHoudiniThemeEngine({
      fallbackTokens: {
        background: "#09090b",
        foreground: "#f4f4f5",
        accent: "#3b82f6",
        surface: "#18181b",
      },
      externalThemeUrl: process.env.NEXT_PUBLIC_THEME_ENDPOINT,
      onError: (error) => {
        console.warn("Theme engine fallback activated", error.message);
      },
    });
  }, []);

  // Keep `system` in sync with OS preference changes.
  useEffect(() => {
    if (mode !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [mode, applyTheme]);

  const setMode = useCallback(
    (nextMode: ThemeMode) => {
      setModeState(nextMode);
      localStorage.setItem(THEME_STORAGE_KEY, nextMode);
      applyTheme(nextMode);
    },
    [applyTheme],
  );

  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
