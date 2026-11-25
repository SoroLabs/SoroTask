import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getAvailableLocales,
  getLocaleFromAcceptLanguage,
  getTextDirection,
  getTranslation,
  translations,
} from '@/i18n';
import { getDirectionClass } from '@/i18n/formatting';

function flattenKeys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'string'
      ? [path]
      : flattenKeys(child as Record<string, unknown>, path);
  });
}

describe('internationalization catalogs', () => {
  it('exposes the twelve supported locales in the product language list', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(12);
    expect(getAvailableLocales().map(({ code }) => code)).toEqual(SUPPORTED_LOCALES);
  });

  it('chooses the best supported language from Accept-Language preferences', () => {
    expect(getLocaleFromAcceptLanguage('fr-CA;q=0.6, ja-JP;q=0.9')).toBe('ja');
    expect(getLocaleFromAcceptLanguage('ar-EG, en-US;q=0.8')).toBe('ar');
    expect(getLocaleFromAcceptLanguage('xx-ZZ, *;q=0.5')).toBe(DEFAULT_LOCALE);
    expect(getLocaleFromAcceptLanguage(null)).toBe(DEFAULT_LOCALE);
  });

  it('provides every English catalog key for every supported locale', () => {
    const englishKeys = flattenKeys(translations.en);

    for (const locale of SUPPORTED_LOCALES) {
      expect(flattenKeys(translations[locale]).sort()).toEqual(englishKeys.sort());
      for (const key of englishKeys) {
        expect(getTranslation(locale, key)).not.toBe(key);
      }
    }
  });

  it('sets RTL direction only for Arabic', () => {
    expect(getTextDirection('ar')).toBe('rtl');
    expect(getDirectionClass('ar')).toBe('rtl');
    for (const locale of SUPPORTED_LOCALES.filter((code) => code !== 'ar')) {
      expect(getTextDirection(locale)).toBe('ltr');
      expect(getDirectionClass(locale)).toBe('ltr');
    }
  });
});
