/**
 * i18n Core - Translation and localization system
 * Manages translation files and locale operations
 */

import en from './translations/en.json';
import es from './translations/es.json';
import fr from './translations/fr.json';
import zh from './translations/zh.json';
import de from './translations/de.json';

export type Locale = 'en' | 'es' | 'fr' | 'zh' | 'de';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'es', 'fr', 'zh', 'de'];

export const DEFAULT_LOCALE: Locale = 'en';

// Translation catalog
const translations: Record<Locale, typeof en> = {
  en,
  es,
  fr,
  zh,
  de,
};

/**
 * Get locale name in English
 */
export function getLocaleName(locale: Locale): string {
  const names: Record<Locale, string> = {
    en: 'English',
    es: 'Español (Spanish)',
    fr: 'Français (French)',
    zh: '中文 (Chinese)',
    de: 'Deutsch (German)',
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
    fr: '🇫🇷',
    zh: '🇨🇳',
    de: '🇩🇪',
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
    fr: 'fr',
    zh: 'zh',
    de: 'de',
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
    const stored = localStorage.getItem('sorotask_locale');
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
      localStorage.setItem('sorotask_locale', locale);
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
    case 'de':
      return 'n'; // Already handled in translation
    case 'zh':
      return ''; // Chinese doesn't use plurals
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
      code: 'de',
      name: 'German',
      flag: '🇩🇪',
      nativeName: 'Deutsch',
    },
  ];
}
