/**
 * Asynchronous locale dictionary loading (#1242).
 *
 * Bundling six locales into the main chunk means every visitor downloads
 * German and Chinese to read the page in English. This module loads a
 * dictionary on demand with a dynamic `import()` and memoises the promise, so
 * switching back to a language already visited is synchronous from the caller's
 * point of view.
 *
 * The statically-imported catalogue in `index.ts` is kept as the SSR/first-paint
 * source; this is the client-side refinement on top of it. English is special-
 * cased to resolve immediately, because a first render must never wait on a
 * network round trip and it is the fallback for every missing key.
 */

import {
  DEFAULT_LOCALE,
  type Locale,
  translations as staticCatalogs,
} from "./index";

export type Dictionary = Record<string, unknown>;

type DictionaryLoader = () => Promise<{ default: Dictionary }>;

/**
 * Explicit loader table rather than a computed `import()` path: bundlers can
 * only code-split a dynamic import whose specifier it can see literally, so
 * building the path at runtime would silently pull every locale into one chunk.
 */
const LOADERS: Record<Locale, DictionaryLoader | null> = {
  // The default locale ships in the main bundle, so there is nothing to load.
  en: null,
  es: () => import("./translations/es.json"),
  fr: () => import("./translations/fr.json"),
  pt: () => import("./translations/pt.json"),
  zh: () => import("./translations/zh.json"),
  de: () => import("./translations/de.json"),
  ar: () => import("./translations/ar.json"),
};

/** In-flight or settled loads, keyed by locale. Holds the promise, not the
 *  result, so concurrent callers share one request. */
const cache = new Map<Locale, Promise<Dictionary>>();

export function isLocaleLoaded(locale: Locale): boolean {
  return locale === DEFAULT_LOCALE || cache.has(locale);
}

/**
 * Resolves a locale's dictionary.
 *
 * Never rejects: a failed chunk load falls back to the default catalogue so a
 * network blip downgrades the page to English rather than showing keys.
 */
export async function loadDictionary(locale: Locale): Promise<Dictionary> {
  if (locale === DEFAULT_LOCALE)
    return staticCatalogs[DEFAULT_LOCALE] as Dictionary;

  const cached = cache.get(locale);
  if (cached) return cached;

  const loader = LOADERS[locale];
  if (!loader) return staticCatalogs[DEFAULT_LOCALE] as Dictionary;

  const pending = loader()
    .then((module) => {
      const dictionary = (module.default ?? module) as Dictionary;
      cache.set(locale, Promise.resolve(dictionary));
      return dictionary;
    })
    .catch(() => {
      // Drop the failure from the cache so a later attempt can retry.
      cache.delete(locale);
      return staticCatalogs[DEFAULT_LOCALE] as Dictionary;
    });

  cache.set(locale, pending);
  return pending;
}

/**
 * Warms several dictionaries at once, e.g. when a locale picker opens.
 * Failures are swallowed by `loadDictionary`, so this cannot reject.
 */
export async function preloadLocales(
  locales: readonly Locale[],
): Promise<void> {
  await Promise.all(locales.map((locale) => loadDictionary(locale)));
}

/** Test seam: forgets everything loaded so far. */
export function resetDictionaryCache(): void {
  cache.clear();
}

/** Test seam: the loader table, so tests can stub a single locale. */
export function __setLoaderForTesting(
  locale: Locale,
  loader: DictionaryLoader | null,
): void {
  LOADERS[locale] = loader;
}
