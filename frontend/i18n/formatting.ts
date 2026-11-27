/**
 * Locale formatting utilities
 * Handles locale-aware formatting of dates, times, numbers, XLM/Stroops
 * amounts, and relative text.
 */

import type { Locale } from "./index";
import { getTextDirection, isRtlLocale } from "./index";

/** Stellar's smallest unit. 1 XLM = 10^7 stroops. */
export const STROOPS_PER_XLM = 10_000_000;

/** XLM's ISO-4217-style code, used for `Intl` currency formatting. */
export const XLM_CURRENCY = "XLM";

/**
 * BCP-47 tags for `Intl`, kept in one table.
 *
 * This was previously duplicated inline in five functions and `pt` was missing
 * from every copy, which is why Portuguese fell back to `toString()` and
 * printed unformatted numbers. One table means one place to fix.
 */
const INTL_LOCALES: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  pt: "pt-BR",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  de: "de-DE",
  ru: "ru-RU",
  ar: "ar-EG",
  hi: "hi-IN",
  tr: "tr-TR",
};

/** The BCP-47 tag for `locale`, e.g. `pt-BR`. */
export function toIntlLocale(locale: Locale): string {
  return INTL_LOCALES[locale] ?? INTL_LOCALES.en;
}

/** Runs `fn` with `Intl` support, falling back when the runtime lacks it. */
function withIntl<T>(fn: () => T, fallback: () => T): T {
  try {
    return fn();
  } catch {
    return fallback();
  }
}

/**
 * Format number for locale (handles thousand separators, decimal points)
 */
export function formatNumber(
  value: number,
  locale: Locale,
  options?: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    style?: "decimal" | "percent" | "currency";
    currency?: string;
  },
): string {
  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    pt: 'pt-BR',
    fr: 'fr-FR',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    ar: 'ar-SA',
  };

/** Parses a stroop amount without losing precision. Returns null if invalid. */
export function toBigInt(stroops: string | number | bigint): bigint | null {
  try {
    if (typeof stroops === "bigint") return stroops;
    // A number that is not an integer cannot have come from a u64.
    if (typeof stroops === "number" && !Number.isInteger(stroops)) return null;
    return BigInt(stroops);
  } catch {
    return null;
  }
}

/**
 * Format gas balance with proper locale and unit
 */
export function formatGasBalance(value: number, locale: Locale): string {
  return formatXlm(value, locale, 4);
}

/**
 * Format interval in seconds to human-readable format for locale
 */
export function formatInterval(
  intervalSeconds: number,
  locale: Locale,
): { hours: number; display: string } {
  const hours = Math.round(intervalSeconds / 3600);

  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    pt: 'pt-BR',
    fr: 'fr-FR',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    ar: 'ar-SA',
  };

  const formatter = new Intl.NumberFormat(localeMap[locale]);

  const formats: Record<Locale, string> = {
    en: `${formatter.format(hours)}h (${formatter.format(intervalSeconds)} seconds)`,
    es: `${formatter.format(hours)}h (${formatter.format(intervalSeconds)} segundos)`,
    pt: `${formatter.format(hours)}h (${formatter.format(intervalSeconds)} segundos)`,
    fr: `${formatter.format(hours)}h (${formatter.format(intervalSeconds)} secondes)`,
    pt: `${formatter.format(hours)}h (${formatter.format(intervalSeconds)} segundos)`,
    zh: `${formatter.format(hours)}小时(${formatter.format(intervalSeconds)}秒)`,
    ja: `${formatter.format(hours)}時間（${formatter.format(intervalSeconds)}秒）`,
    ko: `${formatter.format(hours)}시간(${formatter.format(intervalSeconds)}초)`,
    ar: `${formatter.format(hours)} س (${formatter.format(intervalSeconds)} ثانية)`,
  };

  return {
    hours,
    display: formats[locale],
  };
}

/**
 * Format time ago relative to locale
 */
export function formatRelativeTime(date: Date, locale: Locale): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    pt: 'pt-BR',
    fr: 'fr-FR',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    ar: 'ar-SA',
  };

      if (diffDays > 0) {
        return rtf.format(-diffDays, "day");
      }
      if (diffHours > 0) {
        return rtf.format(-diffHours, "hour");
      }
      if (diffMins > 0) {
        return rtf.format(-diffMins, "minute");
      }
      return rtf.format(-diffSecs, "second");
    },
    () => {
      // Fallback for browsers without Intl.RelativeTimeFormat
      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 30) return `${diffDays}d ago`;
      return date.toLocaleDateString(toIntlLocale(locale));
    },
  );
}

/**
 * Format date and time together
 */
export function formatDateTime(
  date: Date,
  locale: Locale,
  options?: {
    year?: "numeric" | "2-digit";
    month?: "numeric" | "2-digit" | "long" | "short";
    day?: "numeric" | "2-digit";
    hour?: "numeric" | "2-digit";
    minute?: "numeric" | "2-digit";
    second?: "2-digit" | "numeric";
    weekday?: "long" | "short" | "narrow";
    timeZone?: string;
  },
): string {
  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    pt: 'pt-BR',
    fr: 'fr-FR',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    ar: 'ar-SA',
  };

  try {
    const formatter = new Intl.DateTimeFormat(localeMap[locale], {
      year: options?.year ?? 'numeric',
      month: options?.month ?? 'short',
      day: options?.day ?? 'numeric',
      hour: options?.hour ?? '2-digit',
      minute: options?.minute ?? '2-digit',
      timeZone: options?.timeZone,
    });

    return formatter.format(date);
  } catch {
    return date.toLocaleDateString(localeMap[locale]);
  }
}

/**
 * Lis supported locales with their collation order for addressing
 */
export function getTextDirection(locale: Locale): 'ltr' | 'rtl' {
  const rtlLocales: Locale[] = ['ar'];
  return rtlLocales.includes(locale) ? 'rtl' : 'ltr';
}

/**
 * Get CSS classes for text direction
 */
export function getDirectionClass(locale: Locale): string {
  return getTextDirection(locale) === "rtl" ? "rtl" : "ltr";
}

export { isRtlLocale };

/**
 * Estimate text expansion for longer translations
 * Returns a scaling factor for CSS adjustments
 */
export function getTextExpansionFactor(locale: Locale): number {
  // Typically, English to other languages expansion:
  // English -> Spanish: +25%
  // English -> French: +30%
  // English -> German: +35%
  // English -> Chinese: -25% (Chinese is more compact)
  const factors: Record<Locale, number> = {
    en: 1.0,
    es: 1.25,
    pt: 1.25,
    fr: 1.3,
    pt: 1.2,
    zh: 0.75,
    ja: 0.8,
    ko: 0.85,
    ar: 1.25,
  };

  return factors[locale];
}

/**
 * Get font adjustments for different locales
 */
export function getFontAdjustments(locale: Locale): {
  letterSpacing: string;
  lineHeight: number;
} {
  const adjustments: Record<
    Locale,
    { letterSpacing: string; lineHeight: number }
  > = {
    en: { letterSpacing: 'normal', lineHeight: 1.5 },
    es: { letterSpacing: 'normal', lineHeight: 1.55 },
    pt: { letterSpacing: 'normal', lineHeight: 1.55 },
    fr: { letterSpacing: 'normal', lineHeight: 1.55 },
    zh: { letterSpacing: '0.05em', lineHeight: 1.8 },
    ja: { letterSpacing: '0.05em', lineHeight: 1.8 },
    ko: { letterSpacing: '0.05em', lineHeight: 1.75 },
    ar: { letterSpacing: 'normal', lineHeight: 1.75 },
  };

  return adjustments[locale];
}
