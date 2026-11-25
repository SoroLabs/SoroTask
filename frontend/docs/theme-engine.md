# Zero-FOUC Theme Engine (#1241)

SoroTask ships four themes — Light, Dark, High-contrast OLED, and System — with
no flash of unstyled content on load, and with every text pair held to a
contrast ratio the test suite enforces.

## Architecture

| Piece                        | Path                                                              | Role                                          |
| ---------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Token table + contrast maths | [`src/lib/theme/themeEngine.ts`](../src/lib/theme/themeEngine.ts) | Canonical values, WCAG maths, mode resolution |
| Pre-paint resolver           | [`app/theme-init.tsx`](../app/theme-init.tsx)                     | Blocking inline script in `<head>`            |
| Token CSS                    | [`app/globals.css`](../app/globals.css)                           | Light / Dark / OLED custom properties         |
| Design tokens                | [`app/design-tokens.css`](../app/design-tokens.css)               | Full token system incl. the OLED block        |
| Toggle                       | [`components/ThemeToggle.tsx`](../components/ThemeToggle.tsx)     | Four-state cycle, accessible label            |
| Provider wiring              | [`app/layout.tsx`](../app/layout.tsx)                             | `next-themes` config + `ThemeInitScript`      |

## How the flash is removed

The theme is decided in three places that must agree:

1. **A blocking inline script in `<head>`** resolves the stored preference and
   stamps `data-theme` on `<html>` before the first paint. This is what removes
   the flash.
2. **The CSS custom properties** map that attribute to a complete token set.
3. **`next-themes`** owns persistence and the `system` value.

Step 1 exists separately even though `next-themes` also injects a script,
because `next-themes` mounts inside `<body>`. The document has therefore already
had an opportunity to paint the server HTML with the default theme — and that is
the flash. Running the resolver from `<head>` means there is no frame in which
the wrong theme is on screen.

The script is deliberately a plain string with no imports: it has to run before
React, and it must not add a byte of JavaScript to the critical path. It is
wrapped in `try`/`catch` throughout, because private-mode Safari throws on
`localStorage` access and an uncaught throw there would abort the parser before
the app renders at all.

`suppressHydrationWarning` on `<html>` is required — the script mutates
attributes, so the server and client markup legitimately differ.

`next-themes` is configured with `disableTransitionOnChange`, which suppresses
transitions for the frame the theme changes. A theme swap replaces dozens of
custom properties at once, and animating that produces a visible sweep across
the page, which is the other half of the perceived flicker.

## The light-mode token gap

The previous `globals.css` defined a `[data-theme="dark"]` block only. In light
mode `var(--bg-surface)`, `var(--text-primary)`, `var(--border)` and friends
resolved to nothing, so components fell back to inherited values. **This is what
the failing contrast audits on custom components were reporting** — there was no
light palette to pass.

Every token is now defined in all three themes, and `themeEngine.test.ts` fails
if the CSS and the TypeScript mirror drift apart.

## Contrast enforcement

`themeEngine.ts` mirrors the token values in TypeScript specifically so the
ratios can be asserted. `src/lib/theme/__tests__/themeEngine.test.ts` checks:

- every text token against every surface at **WCAG AA (4.5:1)**,
- every OLED text token at **AAA (7:1)**,
- status colours and accent-on-accent-fill at AA,
- form-control edges at **3:1** against every surface.

Relative luminance uses sRGB linearisation rather than an average, because WCAG
contrast is defined on linear light and the naive formula understates contrast
for dark colours — which would let a genuinely failing pair pass.

Two values were corrected by these assertions:

| Token                    | Was       | Now       | Reason                              |
| ------------------------ | --------- | --------- | ----------------------------------- |
| `--text-muted` (dark)    | `#71717a` | `#909098` | only 3.08:1 on `--bg-elevated`      |
| `--input-border` (light) | `#d4d4d8` | `#86868e` | 1.48:1, invisible as a control edge |

### Why decorative borders are exempt

`--border` and `--border-subtle` are hairlines — dividers and card edges — and
are deliberately _not_ held to 3:1. WCAG 1.4.11 scopes non-text contrast to
boundaries needed to identify a control; a separator between list rows is not
one, and holding it to 3:1 would flatten the entire surface hierarchy.
`--input-border` is held to 3:1, because that one _is_ the affordance: you have
to be able to see where to click and type.

## High-contrast OLED

Pure black (`#000000`) surfaces, so unlit pixels draw no power, with every text
pair at AAA and control borders brighter than in Dark mode so boundaries stay
visible without relying on a fill difference.

The OS preference is never resolved to OLED. An OLED panel is a hardware
characteristic, and burning in a light UI on one is the user's explicit choice,
not something to infer from the system.

## Theme modes

| Mode     | `data-theme`      | Notes                                                                                               |
| -------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `light`  | `light`           |                                                                                                     |
| `dark`   | `dark`            |                                                                                                     |
| `oled`   | `oled`            | High-contrast, AAA text                                                                             |
| `system` | `light` or `dark` | Prefers `data-theme-mode="system"` so the toggle can show the choice rather than the resolved value |

`resolveTheme()` and `isThemeMode()` are the canonical helpers; the inline script
mirrors them and the tests assert the two cannot drift.

## Testing

```bash
npm test -- src/lib/theme components/__tests__/ThemeToggle
```

The pre-paint script is tested by evaluating it against a fake `localStorage` and
`matchMedia`, and the placeholder is checked with `renderToString` — `render()`
wraps in `act()` and would flush the mount effect, hiding the pre-hydration
markup that the placeholder exists for.
