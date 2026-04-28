import { useCallback, useEffect, useRef } from 'react';

export interface UseUnsavedChangesReturn {
  /**
   * Call before a destructive action (e.g. form reset, discard).
   * Returns true when it is safe to proceed — either the form is clean, or
   * the user explicitly confirmed they want to discard their changes.
   */
  confirmDiscard: (message?: string) => boolean;
}

/**
 * Guards unsaved form changes from being silently lost.
 *
 * - Registers a `beforeunload` handler that fires the native browser warning
 *   when `isDirty` is true and the user attempts to close/reload the tab.
 * - Provides `confirmDiscard` for programmatic guard points (e.g. a Reset
 *   button) so the caller can decide whether to proceed with a destructive
 *   action after asking the user.
 *
 * The `beforeunload` listener is registered once on mount and deregistered on
 * unmount; it reads `isDirty` via a ref so rerenders never add extra listeners.
 *
 * @param isDirty - Whether the form currently has changes that have not been saved.
 */
export function useUnsavedChanges(isDirty: boolean): UseUnsavedChangesReturn {
  // Keep a ref so the stable listener closure always reads the current value.
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!isDirtyRef.current) return;
      // Prevent the browser from navigating away silently.
      e.preventDefault();
      // Legacy browsers require returnValue to be set.
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []); // intentionally empty — listener is stable via ref

  const confirmDiscard = useCallback(
    (message = 'You have unsaved changes. Discard them?'): boolean => {
      if (!isDirtyRef.current) return true;
      return window.confirm(message);
    },
    [],
  );

  return { confirmDiscard };
}
