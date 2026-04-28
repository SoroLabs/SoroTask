'use client';

import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.closest('[inert]') && getComputedStyle(el).display !== 'none'
  );
}

interface UseFocusTrapOptions {
  /** Whether the trap is active */
  enabled: boolean;
  /** Whether to restore focus to the previously focused element on deactivation */
  restoreFocus?: boolean;
}

/**
 * Traps keyboard focus within a container element while active.
 * Returns a ref to attach to the container.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  options: UseFocusTrapOptions
): React.RefObject<T | null> {
  const { enabled, restoreFocus = true } = options;
  const containerRef = useRef<T>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Save the element that had focus before the trap activates
  useEffect(() => {
    if (enabled) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement;
    }
  }, [enabled]);

  // Move focus into the container when enabled
  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;
    const focusable = getFocusableElements(container);
    const first = focusable[0];

    if (first) {
      // Defer to let the DOM settle (e.g. CSS transitions)
      const id = requestAnimationFrame(() => first.focus());
      return () => cancelAnimationFrame(id);
    } else {
      // Make the container itself focusable as a fallback
      container.setAttribute('tabindex', '-1');
      const id = requestAnimationFrame(() => container.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [enabled]);

  // Restore focus when trap deactivates
  useEffect(() => {
    if (enabled) return;
    if (!restoreFocus) return;
    const el = previouslyFocusedRef.current;
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus());
    }
  }, [enabled, restoreFocus]);

  // Handle Tab / Shift+Tab cycling
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled || !containerRef.current) return;
    if (e.key !== 'Tab') return;

    const focusable = getFocusableElements(containerRef.current);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first || document.activeElement === containerRef.current) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);

  return containerRef;
}
