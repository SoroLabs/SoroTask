import type { Locale } from './i18n';
import type en from './i18n/translations/en.json';

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
