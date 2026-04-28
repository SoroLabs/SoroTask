/**
 * React Context for i18n
 * Manages locale state and provides translation utilities to components
 */

'use client';

import React, { createContext, useState, useEffect, useCallback } from 'react';
import type { Locale } from './index';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getStoredLocale,
  saveLocale,
  detectLocale,
} from './index';

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  isLoading: boolean;
}

export const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

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
    } finally {
      setIsLoading(false);
    }
  }, [defaultLocale]);

  const setLocale = useCallback((newLocale: Locale) => {
    if (SUPPORTED_LOCALES.includes(newLocale)) {
      setLocaleState(newLocale);
      saveLocale(newLocale);

      // Update document language attribute for accessibility
      if (typeof document !== 'undefined') {
        document.documentElement.lang = newLocale;
      }
    }
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, isLoading }}>
      {children}
    </LocaleContext.Provider>
  );
}
