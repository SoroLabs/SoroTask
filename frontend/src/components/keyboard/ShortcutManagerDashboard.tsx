"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createShortcutManager,
  type ShortcutDefinition,
  type ShortcutMatch,
} from "@/src/lib/keyboard/shortcutManager";

export interface ShortcutManagerDashboardProps {
  shortcuts: ShortcutDefinition[];
  onShortcutAction?: (shortcut: ShortcutMatch) => void;
}

export function ShortcutManagerDashboard({
  shortcuts,
  onShortcutAction,
}: ShortcutManagerDashboardProps) {
  const [lastTriggered, setLastTriggered] = useState<ShortcutMatch | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [workerMode, setWorkerMode] = useState<"worker" | "main-thread">("main-thread");
  const managerRef = useRef<ReturnType<typeof createShortcutManager> | null>(null);

  const shortcutCount = useMemo(() => shortcuts.length, [shortcuts]);

  useEffect(() => {
    const manager = createShortcutManager({
      shortcuts,
      onShortcut: (shortcut) => {
        setLastTriggered(shortcut);
        onShortcutAction?.(shortcut);
      },
      onError: (error) => {
        setErrors((prev) => [error.message, ...prev].slice(0, 5));
      },
    });

    setWorkerMode(manager.isWorkerBacked ? "worker" : "main-thread");
    managerRef.current = manager;

    return () => {
      manager.destroy();
      managerRef.current = null;
    };
  }, [onShortcutAction, shortcuts]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      managerRef.current?.processKeyboardEvent({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <section
      data-testid="shortcut-dashboard"
      className="rounded-xl border border-neutral-700/50 bg-neutral-900/40 p-4"
      aria-label="Shortcut manager dashboard"
    >
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Shortcut Manager</h2>
          <p className="text-xs text-neutral-400">
            {shortcutCount} shortcuts registered • processing in {workerMode}
          </p>
        </div>
        <span
          data-testid="shortcut-dashboard-mode"
          className={`rounded-full px-2 py-1 text-[11px] font-medium ${
            workerMode === "worker"
              ? "bg-green-500/15 text-green-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {workerMode === "worker" ? "Worker active" : "Main-thread fallback"}
        </span>
      </header>

      <ul className="space-y-2" data-testid="shortcut-dashboard-list">
        {shortcuts.map((shortcut) => (
          <li
            key={shortcut.id}
            className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2"
          >
            <span className="text-sm text-neutral-200">{shortcut.description}</span>
            <kbd className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-300">
              {shortcut.combo}
            </kbd>
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-2 text-xs">
        <div data-testid="shortcut-last-triggered" className="text-neutral-300">
          Last action:{" "}
          {lastTriggered ? `${lastTriggered.description} (${lastTriggered.combo})` : "none"}
        </div>

        {errors.length > 0 && (
          <div
            data-testid="shortcut-dashboard-errors"
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300"
          >
            {errors[0]}
          </div>
        )}
      </div>
    </section>
  );
}

export default ShortcutManagerDashboard;
