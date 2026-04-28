"use client";

import { useTheme, type ThemeMode } from "./ThemeProvider";

const options: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀️" },
  { value: "dark", label: "Dark", icon: "🌙" },
  { value: "system", label: "System", icon: "💻" },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme selector"
      className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-1"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setMode(opt.value)}
          aria-pressed={mode === opt.value}
          title={opt.label}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            mode === opt.value
              ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <span aria-hidden="true">{opt.icon}</span>
          <span className="hidden sm:inline">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
