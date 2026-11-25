'use client';

/**
 * useSavedViews — localStorage-backed persistence for saved filter presets (#874).
 *
 * `SavedViewsPanel` was purely presentational: it took `savedViews` as a prop
 * and emitted callbacks, so nothing actually stored them. Saved views vanished
 * on reload, which makes "saved" the wrong word for what the UI offered.
 *
 * This owns the storage side so the panel stays presentational.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SavedView, TaskFilters } from '@/types/search';

export const SAVED_VIEWS_STORAGE_KEY = 'sorotask:saved-views:v1';

/**
 * Cap on stored views.
 *
 * localStorage is ~5MB per origin and shared with everything else the app
 * keeps there. An unbounded list of presets could crowd out session data, and
 * a UI listing hundreds of views is unusable long before that.
 */
export const MAX_SAVED_VIEWS = 50;

function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.filters === 'object' &&
    v.filters !== null
  );
}

/**
 * Read and validate persisted views.
 *
 * localStorage is user-writable and survives deployments, so its contents are
 * untrusted input: a hand-edited entry, or one written by an older release
 * with a different shape, must not crash the dashboard on mount. Anything that
 * fails validation is dropped rather than propagated.
 */
function readStoredViews(): SavedView[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedView).slice(0, MAX_SAVED_VIEWS);
  } catch {
    // Malformed JSON, or storage disabled (Safari private browsing throws on
    // access). Degrade to no saved views rather than breaking the page.
    return [];
  }
}

function writeStoredViews(views: SavedView[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Quota exceeded or storage unavailable. The in-memory list stays correct
    // for this session; losing persistence is preferable to losing the view.
  }
}

export interface UseSavedViewsResult {
  savedViews: SavedView[];
  saveView: (name: string, filters: TaskFilters) => SavedView | null;
  renameView: (id: string, name: string) => void;
  deleteView: (id: string) => void;
  updateViewFilters: (id: string, filters: TaskFilters) => void;
  /** True once the first read from storage has completed. */
  isHydrated: boolean;
}

export function useSavedViews(): UseSavedViewsResult {
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [isHydrated, setHydrated] = useState(false);

  // Read after mount, never during render: localStorage does not exist during
  // SSR, and seeding state from it directly would make the server and client
  // markup disagree and trigger a hydration mismatch.
  useEffect(() => {
    setSavedViews(readStoredViews());
    setHydrated(true);
  }, []);

  // Keep other tabs in step. Without this, saving a view in one tab and
  // deleting it in another leaves whichever tab writes last silently
  // clobbering the other's changes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SAVED_VIEWS_STORAGE_KEY) {
        setSavedViews(readStoredViews());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((next: SavedView[]) => {
    setSavedViews(next);
    writeStoredViews(next);
  }, []);

  const saveView = useCallback(
    (name: string, filters: TaskFilters): SavedView | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      const now = new Date().toISOString();
      const existing = savedViews.find(
        (v) => v.name.toLowerCase() === trimmed.toLowerCase(),
      );

      // Overwrite a same-named view rather than creating a duplicate: two
      // entries with identical labels are indistinguishable in the list.
      if (existing) {
        const updated: SavedView = { ...existing, filters, updatedAt: now };
        persist(savedViews.map((v) => (v.id === existing.id ? updated : v)));
        return updated;
      }

      if (savedViews.length >= MAX_SAVED_VIEWS) return null;

      const view: SavedView = {
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        filters,
        createdAt: now,
        updatedAt: now,
      };
      persist([...savedViews, view]);
      return view;
    },
    [savedViews, persist],
  );

  const renameView = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      persist(
        savedViews.map((v) =>
          v.id === id ? { ...v, name: trimmed, updatedAt: new Date().toISOString() } : v,
        ),
      );
    },
    [savedViews, persist],
  );

  const deleteView = useCallback(
    (id: string) => persist(savedViews.filter((v) => v.id !== id)),
    [savedViews, persist],
  );

  const updateViewFilters = useCallback(
    (id: string, filters: TaskFilters) => {
      persist(
        savedViews.map((v) =>
          v.id === id ? { ...v, filters, updatedAt: new Date().toISOString() } : v,
        ),
      );
    },
    [savedViews, persist],
  );

  return { savedViews, saveView, renameView, deleteView, updateViewFilters, isHydrated };
}
