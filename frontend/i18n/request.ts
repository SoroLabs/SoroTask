import { cookies, headers } from 'next/headers';
import en from './translations/en.json';
import es from './translations/es.json';
import pt from './translations/pt.json';
import fr from './translations/fr.json';
import zh from './translations/zh.json';
import ja from './translations/ja.json';
import ko from './translations/ko.json';
import ar from './translations/ar.json';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  type Locale,
} from './index';

const catalogs: Record<Locale, typeof en> = {
  en,
  es,
  pt,
  fr,
  zh,
  ja,
  ko,
  ar,
};

export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale;
  }

  const headerStore = await headers();
  const accepted = headerStore.get('accept-language');
  const preferred = accepted?.split(',')[0]?.trim().split('-')[0]?.toLowerCase();
  if (preferred && SUPPORTED_LOCALES.includes(preferred as Locale)) {
    return preferred as Locale;
  }

  return DEFAULT_LOCALE;
}

export async function getRequestConfig() {
  const locale = await getRequestLocale();
  return { locale, messages: catalogs[locale] };
}

export default getRequestConfig;
