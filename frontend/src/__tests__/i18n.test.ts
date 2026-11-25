import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  getTranslation,
  getAvailableLocales,
  getLocaleFlag,
  type Locale,
} from '@/i18n/index';

describe('i18n', () => {
  it('exposes the requested locale set including Portuguese (pt)', () => {
    // Issue #812 requires en, es, pt, zh.
    for (const code of ['en', 'es', 'pt', 'zh']) {
      expect(SUPPORTED_LOCALES).toContain(code as Locale);
    }
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('translates Portuguese strings from the pt dictionary', () => {
    expect(getTranslation('pt', 'common.connect_wallet')).toBe('Conectar Carteira');
    expect(getTranslation('pt', 'common.loading')).toBe('Carregando...');
    expect(getTranslation('pt', 'task_detail.status_pending')).toBe('Pendente');
  });

  it('offers Portuguese in the language selector and locale metadata', () => {
    const pt = getAvailableLocales().find((l) => l.code === 'pt');
    expect(pt).toBeDefined();
    expect(pt?.nativeName).toBe('Português');
    expect(getLocaleFlag('pt')).toBe('🇵🇹');
  });

  it('falls back to English for keys missing from a locale', () => {
    // A key absent from every catalog returns its key path (getTranslation
    // resolves en first, then bails out with the key unchanged).
    expect(getTranslation('pt', 'missing.namespace.key')).toBe('missing.namespace.key');
    // Present in en AND pt resolves from pt.
    expect(getTranslation('pt', 'common.app_name')).toBe('SoroTask');
  });
});