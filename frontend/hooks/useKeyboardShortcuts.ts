'use client';

/**
 * useKeyboardShortcuts — global hotkey registration (issue #875).
 *
 * Implemented directly on `keydown` rather than pulling in
 * `react-hotkeys-hook`. The issue suggests that library, but the behaviour
 * needed here is a single document-level listener plus sequence support, and
 * the two rules that actually matter — never firing while the user is typing,
 * and never shadowing a browser shortcut — have to be written by hand either
 * way. Adding a dependency to wrap `addEventListener` would not have removed
 * any of that.
 */

import { useCallback, useEffect, useRef } from 'react';

/** Elements that own the keystroke while focused. */
const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** How long a pending sequence prefix (e.g. `g`) stays armed. */
export const SEQUENCE_TIMEOUT_MS = 1200;

export interface Shortcut {
  /**
   * Either a single key (`'n'`, `'?'`, `'Escape'`) or a two-key sequence
   * written space-separated (`'g k'`), matching the `G K` style in the issue.
   */
  keys: string;
  /** Shown in the help modal. */
  description: string;
  /** Grouping label in the help modal. */
  group?: string;
  handler: (event: KeyboardEvent) => void;
  /**
   * Run even while a text field has focus. Off by default — a shortcut that
   * fires mid-sentence is worse than no shortcut at all.
   */
  allowInEditable?: boolean;
  /** Temporarily disable without unregistering. */
  enabled?: boolean;
}

/** True when the keystroke belongs to whatever the user is typing into. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return EDITABLE.has(target.tagName);
}

/**
 * True when the browser or OS owns this combination.
 *
 * Cmd/Ctrl and Alt combinations are left alone: rebinding Ctrl+T or Cmd+W is
 * hostile, and the browser wins on most of them regardless. `CommandPalette`
 * handles Cmd+K separately because that one is an application convention.
 */
function isReservedCombination(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function normalise(key: string): string {
  // Single characters compare case-insensitively so Shift+/ ("?") and a plain
  // "n" both match their declarations; named keys keep their casing.
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * Registers `shortcuts` on the document for the lifetime of the component.
 *
 * Handlers are held in a ref so re-renders don't tear down and re-attach the
 * listener — otherwise a shortcut fired mid-render could be missed, and a
 * pending sequence prefix would be silently dropped.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  const shortcutsRef = useRef(shortcuts);
  const pendingPrefix = useRef<string | null>(null);
  const prefixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const clearPrefix = useCallback(() => {
    pendingPrefix.current = null;
    if (prefixTimer.current) {
      clearTimeout(prefixTimer.current);
      prefixTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isReservedCombination(event)) return;

      const key = normalise(event.key);
      const editable = isEditableTarget(event.target);

      // Escape is the exception to the editable rule: closing a dialog from
      // inside its own text field is the whole point of Escape.
      const active = shortcutsRef.current.filter(
        (s) => s.enabled !== false && (!editable || s.allowInEditable || s.keys === 'Escape'),
      );
      if (active.length === 0) return;

      // Continue a sequence already in progress.
      if (pendingPrefix.current) {
        const combo = `${pendingPrefix.current} ${key}`;
        const match = active.find((s) => s.keys === combo);
        clearPrefix();
        if (match) {
          event.preventDefault();
          match.handler(event);
        }
        // Swallow the second keystroke either way: the user was mid-sequence,
        // so treating an unmatched follow-up as a fresh single-key shortcut
        // would fire something they did not ask for.
        return;
      }

      // Exact single-key match.
      const match = active.find((s) => s.keys === key);
      if (match) {
        event.preventDefault();
        match.handler(event);
        return;
      }

      // Arm a prefix if any registered sequence starts with this key.
      const startsSequence = active.some((s) => s.keys.startsWith(`${key} `));
      if (startsSequence) {
        pendingPrefix.current = key;
        prefixTimer.current = setTimeout(clearPrefix, SEQUENCE_TIMEOUT_MS);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearPrefix();
    };
  }, [enabled, clearPrefix]);
}

/** Render a shortcut declaration for display, e.g. `'g k'` → `['G', 'K']`. */
export function formatShortcutKeys(keys: string): string[] {
  return keys.split(' ').map((k) => (k.length === 1 ? k.toUpperCase() : k));
}
