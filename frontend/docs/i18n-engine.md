# Internationalisation Engine (#1242)

Locale switching is instant — no page reload — with CLDR-correct pluralisation,
asynchronously loaded dictionaries, XLM/Stroop formatting, and right-to-left
layout support.

## Architecture

| Piece         | Path                                                                    | Role                                               |
| ------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| Core          | [`i18n/index.ts`](../i18n/index.ts)                                     | Locale type, lookup, detection, storage, direction |
| Plural engine | [`i18n/plural.ts`](../i18n/plural.ts)                                   | `Intl.PluralRules` + ICU message formatting        |
| Async loader  | [`i18n/loader.ts`](../i18n/loader.ts)                                   | Code-split dictionaries with a shared cache        |
| Formatting    | [`i18n/formatting.ts`](../i18n/formatting.ts)                           | Numbers, dates, XLM/stroops, text metrics          |
| Provider      | [`context/LocaleContext.tsx`](../context/LocaleContext.tsx)             | Active locale, dictionary, `dir`/`lang`            |
| Hooks         | [`hooks/useI18n.ts`](../hooks/useI18n.ts)                               | `useLocale`, `useTranslation`, `useFormatting`, …  |
| Picker        | [`components/LanguageSelector.tsx`](../components/LanguageSelector.tsx) | Instant switch                                     |
| Catalogues    | [`i18n/translations/`](../i18n/translations)                            | `en es fr pt zh de ar`                             |

Supported locales: **English, Spanish, French, Portuguese, Chinese, German,
Arabic**.

## Instant switching

`setLocale` updates React state **synchronously**, so every subscribed component
re-renders in the same commit. Persistence and the `<html lang>` / `<html dir>`
attributes follow, and neither is on the render path.

The previous implementation called `window.location.reload()`, which discarded
scroll position, any half-filled form, and any transaction awaiting a wallet
signature.

`src/__tests__/languageSwitching.test.tsx` asserts this structurally: it holds
the same DOM node reference and the same component state across a switch. A
reload necessarily replaces the document and every node in it, so this is
stronger evidence than a spy on `window.location.reload` — which is also
unavailable in jsdom, where the method is read-only.

The dictionary load is a _refinement_ on top of that: the statically bundled
English backs the first render, so a page is never blank waiting on a chunk.

## Pluralisation

The old engine returned a `'s'` / `'n'` / `''` suffix and relied on the catalogue
string containing `{count} task{plural}`. That encodes an English-shaped rule
into every translation and cannot express languages needing more than two forms.

`i18n/plural.ts` uses `Intl.PluralRules` — the platform's own CLDR data — and
accepts ICU-style messages:

```json
"{count, plural, =0 {No actions queued} one {# action queued} other {# actions queued}}"
```

Supported branches: `=0` (an exact count, distinct from "any other number"),
`zero`, `one`, `two`, `few`, `many`, `other`, and the `#` shorthand for the
formatted count. `fr` treats 0 as singular and `zh` uses `other` for every
count, both straight from CLDR.

The legacy `{count} task{plural}` form still works, so existing catalogue
entries do not have to be rewritten all at once.

## Asynchronous dictionary loading

`i18n/loader.ts` loads a dictionary with a dynamic `import()` and memoises the
**promise**, so switching back to a language already visited is synchronous from
the caller's point of view and concurrent callers share one request.

The loader table is explicit rather than a computed `import()` path: bundlers
can only code-split a dynamic import whose specifier is visible literally, so
building the path at runtime would silently pull every locale into one chunk.

A failed chunk load falls back to the English catalogue and is evicted from the
cache, so a network blip downgrades the page to English rather than showing raw
keys — and a later attempt can retry.

## Number, currency and date formatting

`formatting.ts` holds a single `INTL_LOCALES` table. It was previously duplicated
inline in five functions **and `pt` was missing from every copy**, which is why
Portuguese fell through to `toString()` and printed unformatted numbers.

| Function             | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `formatNumber`       | Locale-aware decimals, percent, currency |
| `formatXlm`          | XLM amounts with the code appended       |
| `formatStroops`      | Raw stroop amounts, converted exactly    |
| `formatGasBalance`   | Task gas budget, in XLM                  |
| `formatInterval`     | Human-readable schedule                  |
| `formatRelativeTime` | "3 days ago"                             |
| `formatDateTime`     | Locale date + time                       |

`formatStroops` converts on a `BigInt` built from the original string, because a
u64 overflows a JS number well before it overflows the ledger. Trailing zeros in
the fractional part are trimmed, and a fractional input is rejected outright —
it cannot have come from a u64.

`Intl` does not know about XLM, so `formatXlm` appends the code itself rather
than relying on a currency style, which renders inconsistently across engines
for unknown codes.

## Right-to-left layout

`ar` is a supported locale, which makes the RTL support testable rather than
theoretical. `LocaleContext` sets `dir` on `<html>`; without it the browser
still lays out LTR and the UI reads backwards.

`globals.css` adds a `[dir="rtl"]` block expressed with logical properties, so
the existing LTR markup mirrors without a parallel set of rules. `dir` already
flips flex/grid and text alignment, so only genuinely direction-dependent
utilities are listed — the skip-link offset, and monospace contract addresses,
which must stay LTR even inside an RTL paragraph or their trailing characters
visually reorder.

## Adding a key

1. Add it to **all seven** catalogues. `i18nEngine.test.ts` asserts the
   `offline.*` and `theme.*` keys exist in every locale, so a partial addition
   fails the build rather than shipping a raw key to users.
2. Use the ICU plural form for anything with a count. `{count}` also works and
   is resolved to the count inside a plural branch.
3. Never pass a locale string straight to `Intl` — use `toIntlLocale()`.

## Testing

```bash
npm test -- src/__tests__/i18nEngine src/__tests__/i18nPlural src/__tests__/languageSwitching
npm test -- src/__tests__/i18n
```

Jest's `testMatch` does not cover `i18n/**`, so these suites live in
`src/__tests__/`, matching the existing `src/__tests__/i18n.test.ts`.
