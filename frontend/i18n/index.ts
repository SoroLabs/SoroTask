/**
 * i18n Core - Translation and localization system
 * Manages translation files and locale operations
 *
 * Pluralisation and ICU-style messages live in `./plural`; asynchronous
 * dictionary loading lives in `./loader`; locale-aware number/date formatting
 * lives in `./formatting`. This module is the stable surface those build on.
 */

import en from './translations/en.json';
import es from './translations/es.json';
import fr from './translations/fr.json';
import zh from './translations/zh.json';
import pt from './translations/pt.json';
import ja from './translations/ja.json';
import ko from './translations/ko.json';
import ar from './translations/ar.json';

export type Locale = 'en' | 'es' | 'pt' | 'fr' | 'zh' | 'ja' | 'ko' | 'ar';

export const SUPPORTED_LOCALES: readonly Locale[] = [
  'en',
  'es',
  'pt',
  'zh',
  'ja',
  'ko',
  'ar',
  'fr',
];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'sorotask_locale';
export const LOCALE_STORAGE_KEY = LOCALE_COOKIE;
export type MessageCatalog = typeof en;

// Translation catalog
const translations: Record<Locale, typeof en> = {
  en,
  es,
  pt,
  fr,
  pt,
  zh,
  ja,
  ko,
  ar,
};

/** Exposed for the async loader, which needs the statically-bundled English. */
export { translations };

/**
 * Get locale name in English
 */
export function getLocaleName(locale: Locale): string {
  const names: Record<Locale, string> = {
    en: 'English',
    es: 'Español (Spanish)',
    pt: 'Português (Portuguese)',
    fr: 'Français (French)',
    zh: '中文 (Chinese)',
    ja: '日本語 (Japanese)',
    ko: '한국어 (Korean)',
    ar: 'العربية (Arabic)',
  };
  return names[locale];
}

/**
 * Get locale flag emoji
 */
export function getLocaleFlag(locale: Locale): string {
  const flags: Record<Locale, string> = {
    en: '🇺🇸',
    es: '🇪🇸',
    pt: '🇧🇷',
    fr: '🇫🇷',
    zh: '🇨🇳',
    ja: '🇯🇵',
    ko: '🇰🇷',
    ar: '🇸🇦',
  };
  return flags[locale];
}

/**
 * Locales written right-to-left. Drives the `dir` attribute on <html> and the
 * logical-property flip in globals.css.
 */
export const RTL_LOCALES: readonly Locale[] = ["ar"];

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
    en: 'en',
    es: 'es',
    pt: 'pt',
    fr: 'fr',
    zh: 'zh',
    ja: 'ja',
    ko: 'ko',
    ar: 'ar',
  };

  return localeMap[baseLocale] ?? DEFAULT_LOCALE;
}

/** Checks whether an arbitrary string is one of the supported locale codes. */
export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && SUPPORTED_LOCALES.includes(value as Locale);
}

/** Negotiates a supported locale from an HTTP Accept-Language header. */
export function getLocaleFromAcceptLanguage(
  acceptLanguage: string | null,
): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const preferences = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [tag, quality] = entry.trim().split(";q=");
      const parsedQuality = quality === undefined ? 1 : Number(quality);
      return {
        locale: tag.split("-")[0].toLowerCase(),
        quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
        index,
      };
    })
    .filter(({ locale, quality }) => locale !== "*" && quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const preference of preferences) {
    if (isLocale(preference.locale)) return preference.locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * Get locale from storage or default
 */
export function getStoredLocale(): Locale {
  return getStoredLocalePreference() ?? DEFAULT_LOCALE;
}

/** Reads a saved locale without conflating "not chosen" with the default. */
export function getStoredLocalePreference(): Locale | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) {
      return stored as Locale;
    }
  } catch {
    // localStorage not available
  }

  return undefined;
}

/**
 * Save locale to storage
 */
export function saveLocale(locale: Locale): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
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
  if (count === 1) return '';

  // Most European languages add 's' for plural
  switch (locale) {
    case 'en':
      return 's';
    case 'es':
      return 's'; // Task -> Tasks = tarea -> tareas
    case 'fr':
      return 's'; // Task -> Tasks = tâche -> tâches
    case 'zh':
      return ''; // Chinese doesn't use plurals
    case 'ja':
    case 'ko':
      return '';
    case 'ar':
      return '';
    case 'pt':
      return 's';
    default:
      return 's';
  }
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
  return [
    {
      code: 'en',
      name: 'English',
      flag: '🇺🇸',
      nativeName: 'English',
    },
    {
      code: 'es',
      name: 'Spanish',
      flag: '🇪🇸',
      nativeName: 'Español',
    },
    {
      code: 'pt',
      name: 'Portuguese',
      flag: '🇧🇷',
      nativeName: 'Português',
    },
    {
      code: 'fr',
      name: 'French',
      flag: '🇫🇷',
      nativeName: 'Français',
    },
    {
      code: 'zh',
      name: 'Chinese',
      flag: '🇨🇳',
      nativeName: '中文',
    },
    {
      code: 'ja',
      name: 'Japanese',
      flag: '🇯🇵',
      nativeName: '日本語',
    },
    {
      code: 'ko',
      name: 'Korean',
      flag: '🇰🇷',
      nativeName: '한국어',
    },
    {
      code: 'ar',
      name: 'Arabic',
      flag: '🇸🇦',
      nativeName: 'العربية',
    },
  ];
}

const NATIVE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  de: "Deutsch",
  fr: "Français",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
  hi: "हिन्दी",
  tr: "Türkçe",
};
