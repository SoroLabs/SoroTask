import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import {
  DEFAULT_LOCALE,
  getLocaleFromAcceptLanguage,
  isLocale,
  translations,
} from './index';

export default getRequestConfig(async ({ requestLocale }) => {
  const [requestedLocale, cookieStore, headerStore] = await Promise.all([
    requestLocale,
    cookies(),
    headers(),
  ]);

  const savedLocale = cookieStore.get('sorotask_locale')?.value;
  const locale = isLocale(savedLocale)
    ? savedLocale
    : isLocale(requestedLocale)
      ? requestedLocale
      : getLocaleFromAcceptLanguage(headerStore.get('accept-language')) || DEFAULT_LOCALE;

  return {
    locale,
    messages: translations[locale],
  };
});
