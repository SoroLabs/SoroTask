/**
 * React Context for i18n
 *
 * Owns the active locale and the asynchronously-loaded dictionary, and keeps
 * <html lang> / <html dir> in sync so assistive technology and the layout
 * engine both follow the selection.
 *
 * Switching is instant: `setLocale` updates context synchronously, so every
 * subscribed component re-renders with the new copy in the same commit. The
 * dictionary load that follows is a refinement — the statically-bundled
 * English backs the very first render, and any locale already visited resolves
 * from cache with no await at all. The previous implementation reloaded the
 * whole page via `window.location.reload()`, which threw away scroll position,
 * form state, and any in-flight transaction.
 */

"use client";

import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type { Locale } from "../i18n/index";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getStoredLocale,
  saveLocale,
  detectLocale,
  getTextDirection,
  isRtlLocale,
} from "../i18n/index";
import { loadDictionary, type Dictionary } from "../i18n/loader";

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** True while a newly selected locale's dictionary is still in flight. */
  isLoading: boolean;
  /** The resolved copy for the active locale, for consumers that read the
   *  catalogue directly instead of going through `getTranslation`. */
  dictionary: Dictionary;
  direction: "ltr" | "rtl";
  isRtl: boolean;
}

export const LocaleContext = createContext<LocaleContextType | undefined>(
  undefined,
);

interface LocaleProviderProps {
  children: React.ReactNode;
  defaultLocale?: Locale;
}

export function LocaleProvider({
  children,
  defaultLocale = DEFAULT_LOCALE,
}: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [isLoading, setIsLoading] = useState(true);
  const [dictionary, setDictionary] = useState<Dictionary>({});

  // Initialize locale on mount
  useEffect(() => {
    setIsLoading(true);

    try {
      // Try to get stored locale, otherwise detect from browser
      const storedLocale = getStoredLocale();
      const detectedLocale = detectLocale();
      const initialLocale = storedLocale || detectedLocale || DEFAULT_LOCALE;

      if (SUPPORTED_LOCALES.includes(initialLocale)) {
        setLocaleState(initialLocale);
      } else {
        setLocaleState(defaultLocale);
      }
    } catch {
      setLocaleState(defaultLocale);
    }
  }, [defaultLocale]);

  // Load the dictionary whenever the locale settles. Not awaited before the
  // first render: `getTranslation` falls back to English, so the page is
  // always complete, and swapping in the dictionary a tick later is invisible.
  useEffect(() => {
    let active = true;
    setIsLoading(locale !== DEFAULT_LOCALE);

    void loadDictionary(locale).then((loaded) => {
      // Guard against a slow load for an abandoned locale overwriting the
      // dictionary of the one the user actually settled on.
      if (!active) return;
      setDictionary(loaded);
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    if (!SUPPORTED_LOCALES.includes(newLocale)) return;

    // State first: this is what makes the switch instant. Persistence and the
    // <html> attributes follow, and neither is on the render path.
    setLocaleState(newLocale);
    saveLocale(newLocale);

    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.lang = newLocale;
      // RTL locales need `dir` for correct text and control ordering; without
      // it the browser still lays out LTR and the UI reads backwards.
      root.dir = getTextDirection(newLocale);
    }
  }, []);

  const direction = getTextDirection(locale);

  const value = useMemo<LocaleContextType>(
    () => ({
      locale,
      setLocale,
      isLoading,
      dictionary,
      direction,
      isRtl: isRtlLocale(locale),
    }),
    [locale, setLocale, isLoading, dictionary, direction],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
