/**
 * React Hooks for i18n
 * Provides translation and locale utilities to components
 */

'use client';

import { useContext, useMemo } from 'react';
import { LocaleContext } from '@/context/LocaleContext';
import type { Locale } from '@/i18n/index';
import {
  getTranslation,
  pluralize,
  getLocaleName,
  getLocaleFlag,
} from '@/i18n/index';
import {
  formatNumber,
  formatGasBalance,
  formatInterval,
  formatRelativeTime,
  formatDateTime,
  getTextExpansionFactor,
  getFontAdjustments,
  getDirectionClass,
} from '@/i18n/formatting';

/**
 * Hook to access locale and setLocale
 */
export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within LocaleProvider');
  }
  return context;
}

/**
 * Hook to get translation function
 */
export function useTranslation() {
  const { locale } = useLocale();

  return useMemo(
    () => ({
      t: (keyPath: string, variables?: Record<string, string | number>) =>
        getTranslation(locale, keyPath, variables),
      locale,
      localeName: getLocaleName(locale),
      localeFlag: getLocaleFlag(locale),
    }),
    [locale]
  );
}

/**
 * Hook to get translation with pluralization support
 */
export function useTranslationWithPlural() {
  const { locale } = useLocale();

  return useMemo(
    () => ({
      t: (keyPath: string, variables?: Record<string, string | number>) => {
        let finalVariables = variables || {};

        // Handle plural suffix
        const pluralMatch = keyPath.match(/\{plural\}/);
        if (pluralMatch && finalVariables.count) {
          const count = Number(finalVariables.count);
          const pluralSuffix = pluralize(count, locale);
          finalVariables = {
            ...finalVariables,
            plural: pluralSuffix,
          };
        }

        return getTranslation(locale, keyPath, finalVariables);
      },
      locale,
    }),
    [locale]
  );
}

/**
 * Hook to get formatting utilities for the current locale
 */
export function useFormatting() {
  const { locale } = useLocale();

  return useMemo(
    () => ({
      formatNumber: (value: number, options?: any) =>
        formatNumber(value, locale, options),
      formatGasBalance: (value: number) => formatGasBalance(value, locale),
      formatInterval: (seconds: number) => formatInterval(seconds, locale),
      formatRelativeTime: (date: Date) => formatRelativeTime(date, locale),
      formatDateTime: (date: Date, options?: any) =>
        formatDateTime(date, locale, options),
      getTextExpansionFactor: () => getTextExpansionFactor(locale),
      getFontAdjustments: () => getFontAdjustments(locale),
      getDirectionClass: () => getDirectionClass(locale),
      locale,
    }),
    [locale]
  );
}

/**
 * Hook to get locale info (name, flag, etc.)
 */
export function useLocaleInfo() {
  const { locale } = useLocale();

  return useMemo(
    () => ({
      locale,
      name: getLocaleName(locale),
      flag: getLocaleFlag(locale),
    }),
    [locale]
  );
}
