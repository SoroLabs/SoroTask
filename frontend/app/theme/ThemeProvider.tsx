"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
} from "react";
import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
} from "next-themes";
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

function ThemeStateProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useNextTheme();
  const mode: ThemeMode =
    theme === "light" || theme === "dark" || theme === "high-contrast"
      ? theme
      : "system";

  const setMode = useCallback(
    (nextMode: ThemeMode) => setTheme(nextMode),
    [setTheme],
  );

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

  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark", "high-contrast"]}
      storageKey="theme"
    >
      <ThemeStateProvider>{children}</ThemeStateProvider>
    </NextThemesProvider>
  );
}

export const useTheme = () => useContext(ThemeContext);
