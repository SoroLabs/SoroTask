/**
 * React Context for i18n
 * Manages locale state and provides translation utilities to components
 */

'use client';

import React, { createContext, useState, useEffect, useCallback } from 'react';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getStoredLocale,
  saveLocale,
  detectLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from '@/i18n';
import { getTextDirection as getDirection } from '@/i18n/formatting';

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
      // Browser storage takes precedence; otherwise prefer server/cookie locale,
      // or detect the browser locale for a first-time visitor.
      const explicitlyStored = typeof window !== 'undefined'
        ? window.localStorage.getItem(LOCALE_STORAGE_KEY)
        : null;
      const storedLocale = explicitlyStored ? getStoredLocale() : null;
      const initialLocale = storedLocale || defaultLocale || detectLocale() || DEFAULT_LOCALE;

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

      if (typeof document !== 'undefined') {
        document.documentElement.lang = newLocale;
        document.documentElement.dir = getDirection(newLocale);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.lang = locale;
    document.documentElement.dir = getDirection(locale);
  }, [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, isLoading }}>
      {children}
    </LocaleContext.Provider>
  );
}
