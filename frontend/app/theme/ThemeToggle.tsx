"use client";

import { Contrast, Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "./ThemeProvider";

const options: {
  value: ThemeMode;
  label: string;
  Icon: typeof Sun;
}[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
  { value: "high-contrast", label: "High contrast", Icon: Contrast },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-1"
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setMode(value)}
          aria-pressed={mode === value}
          aria-label={`${label} theme`}
          className={`flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            mode === value
              ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
