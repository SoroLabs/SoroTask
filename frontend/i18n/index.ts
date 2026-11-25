/**
 * i18n Core - Translation and localization system
 * Manages translation files and locale operations
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
  zh,
  ja,
  ko,
  ar,
};

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
 * Detect locale from browser/environment
 */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const browserLocale = navigator.language || navigator.languages?.[0] || DEFAULT_LOCALE;
  const baseLocale = browserLocale.split('-')[0].toLowerCase();

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

  return (localeMap[baseLocale] as Locale) || DEFAULT_LOCALE;
}

/**
 * Get locale from storage or default
 */
export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
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
  if (typeof window !== 'undefined') {
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
 */
export function getTranslation(
  locale: Locale,
  keyPath: string,
  variables?: Record<string, string | number>
): string {
  const catalog = translations[locale] || translations[DEFAULT_LOCALE];
  const keys = keyPath.split('.');

  let value: any = catalog;
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      // Fallback to English if key not found
      value = getTranslation(DEFAULT_LOCALE, keyPath, variables);
      break;
    }
  }

  if (typeof value !== 'string') {
    return keyPath; // Return key if translation not found
  }

  // Replace variables in translation string
  if (variables) {
    let result = value;
    for (const [varName, varValue] of Object.entries(variables)) {
      const regex = new RegExp(`\\{${varName}\\}`, 'g');
      result = result.replace(regex, String(varValue));
    }
    return result;
  }

  return value;
}

/**
 * Pluralize a word based on count
 * Used in translation strings like "{count} task{plural}"
 * Returns 's' for English, '' for singular of other languages
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
