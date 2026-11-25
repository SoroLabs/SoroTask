'use client';

/**
 * KeyboardShortcutsProvider — app-wide hotkeys and the `?` help modal (#875).
 *
 * Mounted once from AppProviders so every dashboard page inherits the same
 * bindings, rather than each page registering its own and drifting.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useKeyboardShortcuts,
  formatShortcutKeys,
  type Shortcut,
} from '../hooks/useKeyboardShortcuts';

interface KeyboardShortcutsContextValue {
  /** Shortcuts currently registered, for the help modal. */
  shortcuts: Shortcut[];
  openHelp: () => void;
  closeHelp: () => void;
  isHelpOpen: boolean;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

export function useKeyboardShortcutsContext(): KeyboardShortcutsContextValue {
  const ctx = useContext(KeyboardShortcutsContext);
  if (!ctx) {
    throw new Error('useKeyboardShortcutsContext must be used inside <KeyboardShortcutsProvider>');
  }
  return ctx;
}

export function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isHelpOpen, setHelpOpen] = useState(false);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  /**
   * Focus the page's search input, falling back to dispatching the event the
   * command palette listens for. `/` should reach whichever search surface the
   * current page actually has rather than assuming one exists.
   */
  const focusSearch = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="search"], input[data-search-input]',
    );
    if (input) {
      input.focus();
      input.select();
      return;
    }
    document.dispatchEvent(new CustomEvent('sorotask:open-command-palette'));
  }, []);

  const shortcuts = useMemo<Shortcut[]>(
    () => [
      {
        keys: 'n',
        description: 'Create a new task',
        group: 'Actions',
        handler: () => router.push('/tasks/new'),
      },
      {
        keys: '/',
        description: 'Focus search',
        group: 'Actions',
        handler: focusSearch,
      },
      {
        keys: '?',
        description: 'Show this help',
        group: 'Actions',
        // Declared so it appears in its own list — a help modal that does not
        // document how it was opened is a small but real gap.
        handler: openHelp,
      },
      {
        keys: 'g k',
        description: 'Go to Keepers',
        group: 'Navigation',
        handler: () => router.push('/keepers'),
      },
      {
        keys: 'g d',
        description: 'Go to Dashboard',
        group: 'Navigation',
        handler: () => router.push('/dashboard'),
      },
      {
        keys: 'g t',
        description: 'Go to Tasks',
        group: 'Navigation',
        handler: () => router.push('/tasks'),
      },
      {
        keys: 'Escape',
        description: 'Close modals and overlays',
        group: 'General',
        // Allowed while typing: closing a dialog from inside its own field is
        // exactly when Escape is most needed.
        allowInEditable: true,
        handler: () => {
          if (isHelpOpen) {
            closeHelp();
            return;
          }
          document.dispatchEvent(new CustomEvent('sorotask:close-overlays'));
        },
      },
    ],
    [router, focusSearch, openHelp, closeHelp, isHelpOpen],
  );

  useKeyboardShortcuts(shortcuts);

  const value = useMemo(
    () => ({ shortcuts, openHelp, closeHelp, isHelpOpen }),
    [shortcuts, openHelp, closeHelp, isHelpOpen],
  );

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
      {isHelpOpen && <KeyboardShortcutsHelp shortcuts={shortcuts} onClose={closeHelp} />}
    </KeyboardShortcutsContext.Provider>
  );
}

/** The `?` overlay listing every registered shortcut, grouped. */
function KeyboardShortcutsHelp({
  shortcuts,
  onClose,
}: {
  shortcuts: Shortcut[];
  onClose: () => void;
}) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, Shortcut[]>();
    for (const s of shortcuts) {
      const key = s.group ?? 'General';
      byGroup.set(key, [...(byGroup.get(key) ?? []), s]);
    }
    return Array.from(byGroup.entries());
  }, [shortcuts]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-help-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        // The backdrop closes on click, so clicks inside the panel must not
        // bubble up to it.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-help-title" className="text-lg font-semibold text-slate-50">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="rounded-md px-2 py-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        {groups.map(([group, items]) => (
          <section key={group} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              {group}
            </h3>
            <ul className="space-y-1.5">
              {items.map((s) => (
                <li key={s.keys} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-300">{s.description}</span>
                  <span className="flex shrink-0 gap-1">
                    {formatShortcutKeys(s.keys).map((k, i) => (
                      <kbd
                        key={`${s.keys}-${i}`}
                        className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-200"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">
          Shortcuts are ignored while typing in a field, except Escape. Two-key
          sequences such as <kbd className="font-mono">G</kbd>{' '}
          <kbd className="font-mono">K</kbd> are pressed one after the other.
        </p>
      </div>
    </div>
  );
}
