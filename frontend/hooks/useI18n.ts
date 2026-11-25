/**
 * React Hooks for i18n
 * Provides translation and locale utilities to components
 */

"use client";

import { useContext, useMemo } from "react";
import { LocaleContext } from "@/context/LocaleContext";
import type { Locale } from "@/i18n/index";
import {
  getTranslation,
  pluralize,
  getLocaleName,
  getLocaleFlag,
  hasTranslation,
  getTextDirection,
  isRtlLocale,
} from "@/i18n/index";
import { getPluralCategory, hasPluralForm } from "@/i18n/plural";
import {
  formatNumber,
  formatGasBalance,
  formatInterval,
  formatRelativeTime,
  formatDateTime,
  formatXlm,
  formatStroops,
  toIntlLocale,
  getTextExpansionFactor,
  getFontAdjustments,
  getDirectionClass,
} from "@/i18n/formatting";
import type { MessageVariables } from "@/i18n/plural";

/**
 * Hook to access locale and setLocale
 */
export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}

/**
 * Hook to get translation function
 */
export function useTranslation() {
  const { locale, isLoading, direction, isRtl } = useLocale();

  return useMemo(
    () => ({
      /** Resolves a dot-path key, interpolating `{name}` and ICU plurals. */
      t: (keyPath: string, variables?: MessageVariables) =>
        getTranslation(locale, keyPath, variables),
      /** Whether a key resolves to real copy, for graceful hardcoded fallback. */
      has: (keyPath: string) => hasTranslation(locale, keyPath),
      locale,
      localeName: getLocaleName(locale),
      localeFlag: getLocaleFlag(locale),
      /** True while a newly selected locale's dictionary is in flight. */
      isLoading,
      direction,
      isRtl,
    }),
    [locale, isLoading, direction, isRtl],
  );
}

/**
 * Hook to get translation with pluralization support
 *
 * Handles both plural styles: the ICU form
 * (`{count, plural, one {…} other {…}}`, resolved inside `getTranslation`) and
 * the older `{count} task{plural}` suffix form, where the caller passes a
 * `count` and the legacy `plural` variable is injected.
 */
export function useTranslationWithPlural() {
  const { locale } = useLocale();

  return useMemo(
    () => ({
      t: (keyPath: string, variables?: MessageVariables) => {
        let finalVariables: MessageVariables = variables ?? {};

        // Legacy suffix style: only inject when the caller gave us a count and
        // the catalogue entry actually references `{plural}`.
        const needsSuffix =
          finalVariables.count !== undefined && /\{plural\}/.test(keyPath);

        if (needsSuffix) {
          const count = Number(finalVariables.count);
          finalVariables = {
            ...finalVariables,
            plural: pluralize(count, locale),
          };
        }

        return getTranslation(locale, keyPath, finalVariables);
      },
      /** The CLDR category for a count in the active locale. */
      category: (count: number) => getPluralCategory(count, locale),
      locale,
    }),
    [locale],
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
      /** Locale-aware XLM amount, e.g. "1,234.5 XLM". */
      formatXlm: (value: number, fractionDigits?: number) =>
        formatXlm(value, locale, fractionDigits),
      /** Raw stroop amount, converted exactly on the string. */
      formatStroops: (stroops: string | number | bigint) =>
        formatStroops(stroops, locale),
      formatInterval: (seconds: number) => formatInterval(seconds, locale),
      formatRelativeTime: (date: Date) => formatRelativeTime(date, locale),
      formatDateTime: (date: Date, options?: any) =>
        formatDateTime(date, locale, options),
      getTextExpansionFactor: () => getTextExpansionFactor(locale),
      getFontAdjustments: () => getFontAdjustments(locale),
      getDirectionClass: () => getDirectionClass(locale),
      toIntlLocale: () => toIntlLocale(locale),
      locale,
    }),
    [locale],
  );
}

/**
 * Hook to get locale info (name, flag, etc.)
 */
export function useLocaleInfo() {
  const { locale, direction, isRtl } = useLocale();

  return useMemo(
    () => ({
      locale,
      name: getLocaleName(locale),
      flag: getLocaleFlag(locale),
      direction,
      isRtl,
    }),
    [locale, direction, isRtl],
  );
}

export { hasPluralForm, getPluralCategory, isRtlLocale, getTextDirection };
export type { MessageVariables, Locale };
