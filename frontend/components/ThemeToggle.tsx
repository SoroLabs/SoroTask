"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Contrast, Monitor, Moon, Sun } from "lucide-react";
import {
  THEME_CYCLE,
  THEME_LABELS,
  isThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "@/src/lib/theme/themeEngine";

const ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  oled: Contrast,
  system: Monitor,
};

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // `theme` is undefined until next-themes rehydrates from localStorage. The
  // previous implementation returned `null` while that happened, which removed
  // the button from the header and reflowed the layout on every page load — a
  // second, subtler flash. Rendering a correctly-sized placeholder instead
  // keeps the header geometry stable.
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <span
        aria-hidden
        data-testid="theme-toggle-placeholder"
        className="p-2 rounded-md inline-block w-9 h-9"
      />
    );
  }

  const current = (isThemeMode(theme) ? theme : "system") as ThemeMode;
  const Icon = ICONS[current];
  const resolved: ResolvedTheme =
    current === "system"
      ? ((resolvedTheme as ResolvedTheme) ?? "light")
      : current;

  const cycleTheme = () => {
    const next =
      THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
    setTheme(next);
  };

  return (
    <button
      onClick={cycleTheme}
      className="p-2 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
      aria-label={`Theme: ${THEME_LABELS[current]}. Click to change.`}
      title={THEME_LABELS[current]}
      data-testid="theme-toggle"
      data-theme={current}
    >
      <Icon
        className="w-5 h-5 text-neutral-700 dark:text-neutral-200"
        aria-hidden
      />
      {/* Announced by screen readers; the visible label is icon-only. */}
      <span className="sr-only">{THEME_LABELS[current]}</span>
      {current === "system" && (
        <span className="sr-only">Currently resolving to {resolved}.</span>
      )}
    </button>
  );
}

export default ThemeToggle;
