'use client';

import { useEffect } from 'react';

/**
 * Calls `onEscape` when the Escape key is pressed, while `enabled` is true.
 * Stops propagation so nested overlays can each handle their own Escape.
 */
export function useEscapeKey(onEscape: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape();
      }
    };

    // Capture phase so the innermost overlay wins
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled, onEscape]);
}
