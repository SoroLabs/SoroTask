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
  de: "de-DE",
  ar: "ar-EG",
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
  return withIntl(
    () =>
      new Intl.NumberFormat(toIntlLocale(locale), {
        minimumFractionDigits: options?.minimumFractionDigits ?? 0,
        maximumFractionDigits: options?.maximumFractionDigits ?? 2,
        style: options?.style ?? "decimal",
        currency: options?.currency,
      }).format(value),
    () => value.toString(),
  );
}

/**
 * Format an XLM amount for the locale, with the currency symbol appended.
 *
 * `Intl` does not know about XLM, so a currency style with an unknown code
 * renders as "XLM 1,234.50" in some engines and "¤1,234.50" in others. Appending
 * the code ourselves keeps the output predictable and translatable.
 */
export function formatXlm(
  value: number,
  locale: Locale,
  fractionDigits = 4,
): string {
  if (!Number.isFinite(value)) return "—";

  return withIntl(
    () => {
      const formatted = new Intl.NumberFormat(toIntlLocale(locale), {
        minimumFractionDigits: 0,
        // Seven decimals is the on-chain precision, but showing all of them
        // for a typical gas balance is noise, so default to four.
        maximumFractionDigits: Math.max(0, Math.min(7, fractionDigits)),
      }).format(value);
      return `${formatted} ${XLM_CURRENCY}`;
    },
    () => `${value} ${XLM_CURRENCY}`,
  );
}

/**
 * Format a raw stroop amount, converting to XLM first.
 *
 * Amounts arrive from the chain as strings because a u64 overflows a JS number
 * well before it overflows the ledger, so the conversion is done on the string
 * where it is still exact.
 */
export function formatStroops(
  stroops: string | number | bigint,
  locale: Locale,
): string {
  const asBigInt = toBigInt(stroops);
  if (asBigInt === null) return "—";

  const negative = asBigInt < 0n;
  const absolute = negative ? -asBigInt : asBigInt;

  const whole = absolute / BigInt(STROOPS_PER_XLM);
  const fraction = absolute % BigInt(STROOPS_PER_XLM);

  // Trim trailing zeros in the fractional part: 0.1000000 XLM is 0.1 XLM.
  const fractionText = fraction.toString().padStart(7, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";

  return `${sign}${whole}${fractionText ? `.${fractionText}` : ""} ${XLM_CURRENCY}`;
}

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

  const formatter = new Intl.NumberFormat(toIntlLocale(locale));

  const formats: Record<Locale, string> = {
    en: `${formatter.format(hours)}h (${formatter.format(intervalSeconds)} seconds)`,
    es: `${formatter.format(hours)}h (${formatter.format(intervalSeconds)} segundos)`,
    fr: `${formatter.format(hours)}h (${formatter.format(intervalSeconds)} secondes)`,
    pt: `${formatter.format(hours)}h (${formatter.format(intervalSeconds)} segundos)`,
    zh: `${formatter.format(hours)}小时(${formatter.format(intervalSeconds)}秒)`,
    de: `${formatter.format(hours)}Std (${formatter.format(intervalSeconds)} Sekunden)`,
    ar: `${formatter.format(hours)}س (${formatter.format(intervalSeconds)} ثانية)`,
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

  return withIntl(
    () => {
      const rtf = new Intl.RelativeTimeFormat(toIntlLocale(locale), {
        numeric: "auto",
      });

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
  return withIntl(
    () =>
      new Intl.DateTimeFormat(toIntlLocale(locale), {
        year: options?.year ?? "numeric",
        month: options?.month ?? "short",
        day: options?.day ?? "numeric",
        hour: options?.hour ?? "2-digit",
        minute: options?.minute ?? "2-digit",
        timeZone: options?.timeZone,
      }).format(date),
    () => date.toLocaleDateString(toIntlLocale(locale)),
  );
}

export { getTextDirection };

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
    fr: 1.3,
    pt: 1.2,
    zh: 0.75,
    de: 1.35,
    ar: 1.1,
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
    en: { letterSpacing: "normal", lineHeight: 1.5 },
    es: { letterSpacing: "normal", lineHeight: 1.55 },
    fr: { letterSpacing: "normal", lineHeight: 1.55 },
    pt: { letterSpacing: "normal", lineHeight: 1.55 },
    zh: { letterSpacing: "0.05em", lineHeight: 1.8 },
    de: { letterSpacing: "normal", lineHeight: 1.6 },
    ar: { letterSpacing: "normal", lineHeight: 1.7 },
  };

  return adjustments[locale];
}
