# Frontend localization

The frontend uses `next-intl` message catalogs and the App Router provider in
`app/layout.tsx`. `i18n/request.ts` resolves the locale in this order:

1. The user's `sorotask_locale` cookie.
2. A valid locale supplied by Next.js.
3. The highest-priority supported language in the request's `Accept-Language`
   header.
4. English.

The language selector stores the choice in both the cookie and local storage,
updates the document's `lang` and `dir`, and refreshes server-rendered messages.
The locale catalogs currently cover the shared interface, calendar, task,
forms, and execution-log strings. The legacy `useTranslation` hook continues to
serve components that have not yet migrated; new components should use
`useTranslations` from `next-intl`.

## Adding a language

Add a JSON catalog under `i18n/translations/`, add its locale code and display
metadata in `i18n/index.ts`, and include the catalog in the `translations`
record. Keep the catalog key structure aligned with `en.json`; the i18n test
checks key parity across all supported locales.

For RTL languages, include the locale in `RTL_LOCALES`. Prefer CSS logical
properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, and `end-*`) for new
layout styles. Mark directional icons with `data-rtl-flip` when their visual
direction should reverse in RTL layouts.
