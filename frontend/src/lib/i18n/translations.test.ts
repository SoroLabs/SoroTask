import en from '@/i18n/translations/en.json';
import es from '@/i18n/translations/es.json';
import pt from '@/i18n/translations/pt.json';
import fr from '@/i18n/translations/fr.json';
import zh from '@/i18n/translations/zh.json';
import ja from '@/i18n/translations/ja.json';
import ko from '@/i18n/translations/ko.json';
import ar from '@/i18n/translations/ar.json';
import {
  SUPPORTED_LOCALES,
  getAvailableLocales,
  getStoredLocale,
  getTranslation,
  saveLocale,
  LOCALE_STORAGE_KEY,
} from '@/i18n';
import { getTextDirection, formatNumber } from '@/i18n/formatting';

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return prefix ? { [prefix]: String(value) } : {};
  }

  return Object.entries(value).reduce<Record<string, string>>((result, [key, child]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    return { ...result, ...flatten(child, nextKey) };
  }, {});
}

const catalogs = { en, es, pt, fr, zh, ja, ko, ar };

describe('i18n catalog', () => {
  it('supports exactly the eight required locales', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'zh'].sort());
    expect(getAvailableLocales()).toHaveLength(8);
  });

  it('contains the complete English key schema in every locale', () => {
    const englishKeys = Object.keys(flatten(en)).sort();

    for (const [locale, catalog] of Object.entries(catalogs)) {
      expect(Object.keys(flatten(catalog)).sort(), locale).toEqual(englishKeys);
    }
  });

  it('has no empty translations', () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      for (const [key, value] of Object.entries(flatten(catalog))) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('falls back to English for unknown keys', () => {
    expect(getTranslation('ar', 'missing.translation')).toBe('missing.translation');
  });

  it('interpolates variables safely', () => {
    expect(getTranslation('ar', 'calendar.selected_date_title', { date: '2026-11-25' }))
      .toBe('المهام في 2026-11-25');
  });
});

describe('i18n locale behavior', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('uses RTL layout metadata for Arabic', () => {
    expect(getTextDirection('ar')).toBe('rtl');
    expect(getTextDirection('en')).toBe('ltr');
  });

  it('uses locale-aware number formatting', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'ar')).not.toBe('1,234.5');
  });

  it('persists the selected locale', () => {
    saveLocale('ar');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ar');
    expect(document.cookie).toContain('sorotask_locale=ar');
    expect(getStoredLocale()).toBe('ar');
  });
});
