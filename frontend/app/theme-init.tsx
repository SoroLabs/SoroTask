/**
 * Blocking pre-paint theme resolver (#1241).
 *
 * This component emits a <script> into <head> that runs before the browser
 * paints. It resolves the stored preference and stamps `data-theme` (plus
 * `color-scheme`) onto <html> synchronously.
 *
 * Why this exists even though next-themes also injects a script: next-themes
 * mounts inside <body>, so the document has already had an opportunity to paint
 * the server HTML with the default theme. That is the flash. Running this
 * instead — from <head>, ahead of the first paint — means there is no frame in
 * which the wrong theme is on screen.
 *
 * The resolution logic is duplicated from `next-themes` on purpose: it must run
 * before React, so it cannot use hooks, and it must not add a byte of
 * JavaScript to the critical path beyond this inline string.
 * `themeEngine.test.ts` asserts that the inline guard matches the canonical
 * `isThemeMode` validator so the two cannot drift.
 */

import {
  SYSTEM_DARK_QUERY,
  THEME_MODES,
  THEME_STORAGE_KEY,
} from "@/src/lib/theme/themeEngine";

/** Kept as a plain string so it is a single synchronous statement with no
 *  hydration surface. Wrapped in try/catch throughout: private-mode Safari
 *  throws on `localStorage` access, and a throw here would abort the parser
 *  before the app renders at all. */
const SCRIPT = [
  "(function(){try{",
  "var d=document.documentElement,s=null;",
  `try{s=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});}catch(e){}`,
  `var v=${JSON.stringify(THEME_MODES)},m=v.indexOf(s)>-1?s:"system",dark=false;`,
  `try{dark=window.matchMedia(${JSON.stringify(SYSTEM_DARK_QUERY)}).matches;}catch(e){}`,
  'var r=m==="system"?(dark?"dark":"light"):m;',
  'd.setAttribute("data-theme",r);d.setAttribute("data-theme-mode",m);',
  'd.style.colorScheme=r==="light"?"light":"dark";',
  "}catch(e){}})();",
].join("");

export function ThemeInitScript() {
  // No `async`/`defer`: the whole point is to run before the first paint.
  return <script suppressHydrationWarning>{SCRIPT}</script>;
}

export { SCRIPT as THEME_INIT_SCRIPT };
