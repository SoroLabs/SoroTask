"use client";

import { useContext, useEffect, useState } from "react";
import { LocaleContext } from "@/context/LocaleContext";
import {
  detectLocale,
  getAvailableLocales,
  getStoredLocale,
  getTextDirection,
  saveLocale,
  type Locale,
} from "@/i18n/index";

const LOCALES = getAvailableLocales();

/**
 * Reads the active locale from context when a `LocaleProvider` is present, and
 * falls back to local state backed by `localStorage` when it is not.
 *
 * The fallback matters: this component is rendered from `app/page.tsx`, from
 * Storybook, and from tests that render a page in isolation, none of which wrap
 * the tree in the app's provider stack. Making a leaf control throw
 * "must be used within LocaleProvider" is hostile — the picker has everything
 * it needs to work on its own.
 */
function useOptionalLocale(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  isLoading: boolean;
} {
  const context = useContext(LocaleContext);

  const [fallback, setFallback] = useState<Locale>("en");

  // Read storage after mount: it does not exist during SSR, and seeding from it
  // on the first render would desynchronise the server and client markup.
  useEffect(() => {
    if (context) return;
    setFallback(getStoredLocale() ?? detectLocale());
  }, [context]);

  if (context) return context;

  return {
    locale: fallback,
    isLoading: false,
    setLocale: (locale: Locale) => {
      saveLocale(locale);
      setFallback(locale);
      if (typeof document !== "undefined") {
        document.documentElement.lang = locale;
        document.documentElement.dir = getTextDirection(locale);
      }
    },
  };
}

/**
 * Language picker.
 *
 * Switching goes through `LocaleContext` when available, so every component
 * reading the locale re-renders in the same commit — no page reload. The
 * previous implementation called `window.location.reload()`, which discarded
 * scroll position, any half-filled form, and any transaction awaiting a wallet
 * signature.
 *
 * There is deliberately no `mounted` guard on the picker itself: the value now
 * comes from context (or, in the fallback, from an effect that only changes the
 * selected option) rather than gating the whole element. The previous version
 * read `localStorage` during render and returned `null` until mount, which
 * punched a hole in the header layout on every page load.
 */
export function LanguageSelector() {
  const { locale, setLocale, isLoading } = useOptionalLocale();

  return (
    <div className="relative inline-block">
      <label className="sr-only" htmlFor="language-selector">
        Select language
      </label>
      <select
        id="language-selector"
        data-testid="language-selector"
        value={locale}
        // Disabled only while a *newly chosen* locale's dictionary loads. The
        // already-rendered copy stays on screen; this just blocks a rapid
        // second change from racing the first.
        disabled={isLoading}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="appearance-none bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-sm font-medium py-2 pl-3 pr-8 rounded-md border border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {LOCALES.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.flag} {entry.nativeName}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-neutral-500 dark:text-neutral-400">
        <svg
          className="fill-current h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          aria-hidden
        >
          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
        </svg>
      </div>
    </div>
  );
}

export default LanguageSelector;
