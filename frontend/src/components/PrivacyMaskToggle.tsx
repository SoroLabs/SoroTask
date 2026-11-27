"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

export const PRIVACY_MASK_STORAGE_KEY = "sorotask.privacy.mask.v1";
export const PRIVACY_MASK_ATTR = "data-privacy-mask";
export const PRIVACY_MASK_EVENT = "sorotask:privacy-mask-change";

/**
 * Safely reads the persisted privacy mask preference from localStorage.
 */
export function readPrivacyMaskPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PRIVACY_MASK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Safely persists the privacy mask preference to localStorage.
 */
export function writePrivacyMaskPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PRIVACY_MASK_STORAGE_KEY,
      enabled ? "true" : "false",
    );
  } catch {
    // Ignore storage errors (e.g. private browsing / disabled storage)
  }
}

/**
 * Synchronously applies or removes the global privacy mask attribute on <html>.
 * Mutating a single root attribute lets CSS blur/mask all [data-privacy-sensitive]
 * elements across the entire app in one style recalculation (< 16ms).
 */
export function applyPrivacyMaskToDocument(enabled: boolean): void {
  if (typeof document === "undefined") return;
  if (enabled) {
    document.documentElement.setAttribute(PRIVACY_MASK_ATTR, "true");
  } else {
    document.documentElement.removeAttribute(PRIVACY_MASK_ATTR);
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if (target.isContentEditable || target.getAttribute("contenteditable") === "true") {
    return true;
  }
  return false;
}

function broadcastPrivacyMaskChange(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(PRIVACY_MASK_EVENT, { detail: enabled }),
  );
}

export interface UsePrivacyMaskResult {
  isMasked: boolean;
  setMasked: (enabled: boolean) => void;
  toggle: () => void;
  lastToggleDurationMs: number | null;
}

/**
 * Hook for reading and controlling the global Zero-Data-Leak Privacy Mask state.
 * Synchronizes state across components, browser tabs, and the DOM root attribute.
 */
export function usePrivacyMask(): UsePrivacyMaskResult {
  const [isMasked, setIsMaskedState] = useState<boolean>(false);
  const [lastToggleDurationMs, setLastToggleDurationMs] = useState<number | null>(
    null,
  );
  const isMaskedRef = useRef<boolean>(false);

  const setMasked = useCallback((enabled: boolean) => {
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    // Apply DOM attribute synchronously first for < 16ms visual masking
    applyPrivacyMaskToDocument(enabled);
    isMaskedRef.current = enabled;
    writePrivacyMaskPreference(enabled);
    broadcastPrivacyMaskChange(enabled);
    setIsMaskedState(enabled);

    const end =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    setLastToggleDurationMs(Math.max(0, end - start));
  }, []);

  const toggle = useCallback(() => {
    setMasked(!isMaskedRef.current);
  }, [setMasked]);

  // Hydrate persisted preference on mount and subscribe to cross-component / cross-tab updates
  useEffect(() => {
    const initial = readPrivacyMaskPreference();
    isMaskedRef.current = initial;
    applyPrivacyMaskToDocument(initial);
    setIsMaskedState(initial);

    const handleCustomEvent = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail;
      if (typeof next === "boolean" && next !== isMaskedRef.current) {
        isMaskedRef.current = next;
        applyPrivacyMaskToDocument(next);
        setIsMaskedState(next);
      }
    };

    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key !== PRIVACY_MASK_STORAGE_KEY) return;
      const next = event.newValue === "true";
      if (next !== isMaskedRef.current) {
        isMaskedRef.current = next;
        applyPrivacyMaskToDocument(next);
        setIsMaskedState(next);
      }
    };

    window.addEventListener(PRIVACY_MASK_EVENT, handleCustomEvent);
    window.addEventListener("storage", handleStorageEvent);

    return () => {
      window.removeEventListener(PRIVACY_MASK_EVENT, handleCustomEvent);
      window.removeEventListener("storage", handleStorageEvent);
    };
  }, []);

  return {
    isMasked,
    setMasked,
    toggle,
    lastToggleDurationMs,
  };
}

export interface PrivacyMaskValueProps {
  children: React.ReactNode;
  fallback?: string;
  className?: string;
  /** When true, replaces text with fallback characters instead of only CSS blur */
  replaceText?: boolean;
}

/**
 * Wrapper component for sensitive financial values (balances, addresses, PnL).
 * Automatically receives instant CSS blur via [data-privacy-sensitive="true"]
 * and optionally replaces DOM text when Privacy Mask is active.
 */
export function PrivacyMaskValue({
  children,
  fallback = "••••••",
  className = "",
  replaceText = false,
}: PrivacyMaskValueProps) {
  const { isMasked } = usePrivacyMask();

  return (
    <span
      data-privacy-sensitive="true"
      aria-label={isMasked ? "Sensitive value hidden by privacy mask" : undefined}
      className={className}
    >
      {isMasked && replaceText ? fallback : children}
    </span>
  );
}

export interface PrivacyMaskToggleProps {
  className?: string;
  showShortcutHint?: boolean;
  onToggle?: (masked: boolean) => void;
}

/**
 * Global Privacy Mask toggle button with Shift+P keyboard shortcut.
 * Instantly blurs/masks all sensitive financial metrics across the application
 * and persists the user's preference in localStorage.
 */
export function PrivacyMaskToggle({
  className = "",
  showShortcutHint = true,
  onToggle,
}: PrivacyMaskToggleProps) {
  const { isMasked, toggle } = usePrivacyMask();
  const onToggleRef = useRef(onToggle);

  useEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  const handleToggle = useCallback(() => {
    const next = !isMasked;
    toggle();
    onToggleRef.current?.(next);
  }, [isMasked, toggle]);

  // Global Shift+P keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.repeat &&
        event.key.toLowerCase() === "p"
      ) {
        if (isEditableTarget(event.target)) {
          return;
        }
        event.preventDefault();
        const next = !document.documentElement.hasAttribute(PRIVACY_MASK_ATTR);
        toggle();
        onToggleRef.current?.(next);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return (
    <div className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <button
        type="button"
        role="switch"
        aria-checked={isMasked}
        aria-keyshortcuts="Shift+P"
        aria-label={
          isMasked
            ? "Disable privacy mask (Shift+P)"
            : "Enable privacy mask (Shift+P)"
        }
        data-testid="privacy-mask-toggle"
        onClick={handleToggle}
        className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
          isMasked
            ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
            : "border-slate-700 bg-slate-900/80 text-slate-200 hover:border-slate-500 hover:bg-slate-800/80"
        }`}
      >
        {isMasked ? (
          <EyeOff className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
        )}
        <span className="inline-flex items-center gap-1.5">
          {isMasked && (
            <ShieldCheck
              className="h-3.5 w-3.5 shrink-0 text-emerald-300"
              aria-hidden="true"
            />
          )}
          {isMasked ? "Privacy Guard On" : "Privacy Guard"}
        </span>
        {showShortcutHint && (
          <kbd
            aria-hidden="true"
            className={`ml-1 rounded border px-1.5 py-0.5 font-mono text-[11px] leading-none ${
              isMasked
                ? "border-emerald-400/40 bg-emerald-950/60 text-emerald-200"
                : "border-slate-600 bg-slate-800 text-slate-400"
            }`}
          >
            Shift+P
          </kbd>
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {isMasked
          ? "Privacy mask enabled. Sensitive financial metrics are hidden."
          : "Privacy mask disabled. Sensitive financial metrics are visible."}
      </span>
    </div>
  );
}

export default PrivacyMaskToggle;
