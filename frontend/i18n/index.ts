/**
 * i18n Core - Translation and localization system
 * Manages translation files and locale operations
 *
 * Pluralisation and ICU-style messages live in `./plural`; asynchronous
 * dictionary loading lives in `./loader`; locale-aware number/date formatting
 * lives in `./formatting`. This module is the stable surface those build on.
 */

import en from "./translations/en.json";
import es from "./translations/es.json";
import fr from "./translations/fr.json";
import pt from "./translations/pt.json";
import zh from "./translations/zh.json";
import de from "./translations/de.json";
import ar from "./translations/ar.json";
import {
  formatMessage,
  getPluralCategory,
  type MessageVariables,
} from "./plural";

export type Locale = "en" | "es" | "fr" | "pt" | "zh" | "de" | "ar";

export const SUPPORTED_LOCALES: Locale[] = [
  "en",
  "es",
  "fr",
  "pt",
  "zh",
  "de",
  "ar",
];

export const DEFAULT_LOCALE: Locale = "en";

// Translation catalog
const translations: Record<Locale, typeof en> = {
  en,
  es,
  fr,
  pt,
  zh,
  de,
  ar,
};

/** Exposed for the async loader, which needs the statically-bundled English. */
export { translations };

/**
 * Get locale name in English
 */
export function getLocaleName(locale: Locale): string {
  const names: Record<Locale, string> = {
    en: "English",
    es: "Español (Spanish)",
    fr: "Français (French)",
    pt: "Português (Portuguese)",
    zh: "中文 (Chinese)",
    de: "Deutsch (German)",
    ar: "العربية (Arabic)",
  };
  return names[locale];
}

/**
 * Get locale flag emoji
 */
export function getLocaleFlag(locale: Locale): string {
  const flags: Record<Locale, string> = {
    en: "🇺🇸",
    es: "🇪🇸",
    fr: "🇫🇷",
    pt: "🇵🇹",
    zh: "🇨🇳",
    de: "🇩🇪",
    ar: "🇸🇦",
  };
  return flags[locale];
}

/**
 * Locales written right-to-left. Drives the `dir` attribute on <html> and the
 * logical-property flip in globals.css.
 */
const RTL_LOCALES: readonly Locale[] = ["ar"];

export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

/** The value the `dir` attribute should take for `locale`. */
export function getTextDirection(locale: Locale): "ltr" | "rtl" {
  return isRtlLocale(locale) ? "rtl" : "ltr";
}

/**
 * Detect locale from browser/environment
 */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") {
    return DEFAULT_LOCALE;
  }

  const browserLocale =
    navigator.language || navigator.languages?.[0] || DEFAULT_LOCALE;
  const baseLocale = browserLocale.split("-")[0].toLowerCase();

  // Map common locale codes to supported locales
  const localeMap: Record<string, Locale> = {
    en: "en",
    es: "es",
    fr: "fr",
    pt: "pt",
    zh: "zh",
    de: "de",
    ar: "ar",
  };

  return (localeMap[baseLocale] as Locale) || DEFAULT_LOCALE;
}

/**
 * Get locale from storage or default
 */
export function getStoredLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }

  try {
    const stored = localStorage.getItem("sorotask_locale");
    if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) {
      return stored as Locale;
    }
  } catch {
    // localStorage not available
  }

  return DEFAULT_LOCALE;
}

/**
 * Save locale to storage
 */
export function saveLocale(locale: Locale): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("sorotask_locale", locale);
    } catch {
      // localStorage not available
    }
  }
}

/**
 * Get translation value from key path
 * Supports nested paths like "calendar.title" or "calendar.legend.today"
 *
 * Values containing an ICU plural expression (`{count, plural, …}`) are resolved
 * against the locale, so a single catalogue entry can carry every plural form
 * the language needs.
 */
export function getTranslation(
  locale: Locale,
  keyPath: string,
  variables?: MessageVariables,
): string {
  const resolved = resolve(locale, keyPath);

  if (typeof resolved !== "string") {
    return keyPath; // Return key if translation not found
  }

  return formatMessage(resolved, locale, variables ?? {});
}

/** Walks a dot path in the catalogue, falling back to English then to undefined. */
function resolve(locale: Locale, keyPath: string): unknown {
  const local = walk(translations[locale], keyPath);
  if (typeof local === "string") return local;

  // Fall back to English so a partially-translated catalogue still renders
  // complete copy rather than a mix of strings and raw keys.
  if (locale !== DEFAULT_LOCALE) {
    return walk(translations[DEFAULT_LOCALE], keyPath);
  }

  return undefined;
}

function walk(catalog: unknown, keyPath: string): unknown {
  let value: unknown = catalog;
  for (const key of keyPath.split(".")) {
    if (
      value &&
      typeof value === "object" &&
      key in (value as Record<string, unknown>)
    ) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return value;
}

/**
 * True when a key resolves to a real string in `locale` or in English.
 *
 * Useful for tests and for deciding whether to fall back to hardcoded copy.
 */
export function hasTranslation(locale: Locale, keyPath: string): boolean {
  return typeof resolve(locale, keyPath) === "string";
}

/**
 * The CLDR plural category for a count, e.g. `one` / `few` / `other`.
 * Prefer `getTranslation` with a `count` variable; this is for callers that
 * need to pick a label themselves.
 */
export function pluralCategory(count: number, locale: Locale) {
  return getPluralCategory(count, locale);
}

/**
 * Legacy suffix pluralisation, kept so the existing `"{count} task{plural}"`
 * catalogue entries keep working.
 *
 * This is inherently lossy — a single suffix cannot express Arabic's six
 * categories — so new entries should use the ICU plural form instead. See
 * `./plural` and `getTranslation`.
 */
export function pluralize(count: number, locale: Locale): string {
  const category = getPluralCategory(count, locale);
  if (category === "one") return "";
  // Chinese and Japanese have no plural inflection at all.
  if (locale === "zh") return "";
  return "s";
}

/**
 * Get all available locales with metadata
 */
export function getAvailableLocales(): Array<{
  code: Locale;
  name: string;
  flag: string;
  nativeName: string;
  /** Drives the `dir` attribute when the locale is selected. */
  direction: "ltr" | "rtl";
}> {
  return SUPPORTED_LOCALES.map((code) => ({
    code,
    name: getLocaleName(code),
    flag: getLocaleFlag(code),
    // The picker shows the endonym, so a reader who cannot read the English
    // name can still find their language.
    nativeName: NATIVE_NAMES[code],
    direction: getTextDirection(code),
  }));
}

const NATIVE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  pt: "Português",
  zh: "中文",
  de: "Deutsch",
  ar: "العربية",
};
