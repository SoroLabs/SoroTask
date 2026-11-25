"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDraftStore } from "./DraftStore";
import type { TaskDraft } from "./types";

interface UseDraftPersistenceOptions {
  draftKey: string;
  /** Debounce delay in ms before auto-saving (default: 800) */
  debounceMs?: number;
}

interface UseDraftPersistenceResult {
  draft: TaskDraft | null;
  saveDraft: (patch: Omit<TaskDraft, "draftKey" | "savedAt">) => void;
  deleteDraft: () => Promise<void>;
  isSaving: boolean;
}

/**
 * Hook for persisting task draft state to IndexedDB with debounced auto-save.
 *
 * On mount it restores the last saved draft for the given key.
 * Calls to `saveDraft` are debounced — only the latest value within the
 * debounce window is actually written to IndexedDB.
 */
export function useDraftPersistence({
  draftKey,
  debounceMs = 800,
}: UseDraftPersistenceOptions): UseDraftPersistenceResult {
  const store = getDraftStore();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore on mount
  useEffect(() => {
    let cancelled = false;
    store.get(draftKey).then((saved) => {
      if (!cancelled && saved) setDraft(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey]); // store is a stable singleton

  const saveDraft = useCallback(
    (patch: Omit<TaskDraft, "draftKey" | "savedAt">) => {
      const next: TaskDraft = { ...patch, draftKey, savedAt: Date.now() };
      setDraft(next);

      if (timerRef.current) clearTimeout(timerRef.current);
      setIsSaving(true);

      timerRef.current = setTimeout(async () => {
        try {
          await store.save(next);
        } finally {
          setIsSaving(false);
        }
      }, debounceMs);
    },
    [draftKey, debounceMs] // store is stable
  );

  const deleteDraft = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setDraft(null);
    await store.delete(draftKey);
  }, [draftKey]); // store is stable

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { draft, saveDraft, deleteDraft, isSaving };
}
