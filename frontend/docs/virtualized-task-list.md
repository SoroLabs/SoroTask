# Virtualized Task List — Spike

This document captures the result of the virtualization spike for the task
list (per the "Render very large task collections without UI lag" issue). The
spike is intentionally scoped to a demo route with mock data, since at the
time of writing the real task list component did not yet exist in the
frontend. The goal is to prove the rendering pattern, lock in a library, and
document the tradeoffs so the follow-up implementation can plug it into real
data without re-doing the research.

## TL;DR

- Library: [`@tanstack/react-virtual`](https://tanstack.com/virtual) v3.
- Component: `src/components/VirtualizedTaskList.tsx`.
- Demo route: `/tasks-demo` — toggle between 0 / 1k / 5k / 10k rows, simulate
  loading, exercise keyboard navigation.
- Tests: `src/components/__tests__/VirtualizedTaskList.test.tsx`,
  `src/lib/__tests__/mockTasks.test.ts`.

## Library choice

Three options were considered:

| Library                    | Variable-height | API surface | Bundle | Notes                                        |
| -------------------------- | --------------- | ----------- | ------ | -------------------------------------------- |
| `react-window`             | Limited         | Small       | Tiny   | Best for fixed/known heights only.           |
| `react-virtualized`        | Yes             | Large       | Heavy  | Older API, larger surface, mostly legacy.    |
| `@tanstack/react-virtual`  | Yes (measured)  | Hook-based  | Small  | Headless, framework-agnostic core, modern.   |

`@tanstack/react-virtual` was selected because:

1. It measures real row heights via `ResizeObserver`, so cards with variable
   description lengths size themselves correctly without us pre-computing.
2. It is a headless hook (`useVirtualizer`) — the consumer keeps full control
   over markup, styling, accessibility, and interaction semantics.
3. The API is small enough to wrap in a single component without leaking the
   library into the rest of the codebase.

## How the rendering works

`useVirtualizer` returns a list of "virtual items" describing which row
indices should be in the DOM right now and what their `start` offset is. The
component renders only those rows, absolutely positioned inside a spacer
`<div>` whose height equals the total measured size of all rows. As the user
scrolls, the hook recomputes the slice. Rows pass a `ref` callback to
`virtualizer.measureElement` so their actual heights replace the initial
estimate after first paint.

Concretely for 10,000 rows at ~600px viewport with 120px estimate and
overscan 8: the DOM holds ~13 rows + 16 overscan rows ≈ 30 nodes regardless
of dataset size.

## Preserved interactions

The spike covers the interactions the issue called out as must-keep:

- **Click selection** — `onSelect(id)` callback, visual highlight.
- **Hover state** — Tailwind `hover:` styles on each row.
- **Keyboard navigation** — `ArrowUp`/`ArrowDown`/`Home`/`End` move the
  active row; `Enter`/`Space` selects. The list is `role="listbox"` and uses
  `aria-activedescendant` so screen readers announce the active row without
  needing focus to physically move into virtualized children (which would
  break when those children unmount on scroll).
- **Loading state** — `loading` prop renders a `role="status"` placeholder.
- **Empty state** — rendered when `tasks.length === 0`.
- **Variable-height cards** — driven by description length; measured at
  mount. Confirmed visually in the demo at 5k–10k rows.

A "menus" interaction was deferred — it is a product decision (what menu?
what actions?) that should come from the real task UI work, not from a
virtualization spike. The component exposes `onSelect`, which is enough to
hang a context menu off in the follow-up.

## Tradeoffs and limitations

- **Layout-dependent behavior is hard to unit test under jsdom.** jsdom does
  not implement layout, so `useVirtualizer` cannot measure row sizes or the
  scroll viewport during tests. To keep tests meaningful without a headless
  browser, the component accepts a `forceRenderCount` test hook that renders
  a deterministic slice from the top. This is good enough to assert on row
  content, click selection, and keyboard wiring; it does **not** verify
  scroll math. End-to-end tests (Playwright) are the right tool for that and
  are out of scope for this spike.
- **`aria-activedescendant`, not roving tabindex.** With virtualized rows,
  the active DOM node may unmount during scroll, which would lose focus.
  `aria-activedescendant` keeps focus on the scroll container and points at
  the active row's `id` instead — survives unmounts. The downside is that
  some screen readers handle `aria-activedescendant` less reliably than
  roving focus; if accessibility audit flags this, switching to roving focus
  + `scrollToIndex` on focus change is the upgrade path.
- **Keys depend on stable task ids.** `getItemKey` uses `task.id`. If the
  real data layer ever produces tasks without stable ids, height measurement
  caches will thrash on re-renders.
- **`contain: strict` on the scroll container.** This isolates layout/paint
  for the list but means the container's intrinsic size is decoupled from
  its children — callers must pass a `height`. The demo passes `640`.
- **Latent tsconfig gap (not introduced by this work).** Running
  `npx tsc --noEmit` reports `Cannot find name 'jest'`/`'expect'` etc. in
  test files. `@types/jest` is installed, but the project's `tsconfig.json`
  has no `types` field and TS 6 does not auto-pick it up in this setup.
  `next build` is unaffected because Next excludes tests from its
  typecheck, and `jest` itself runs via `next/jest` which uses SWC. A
  one-line fix is to add `"types": ["jest", "node"]` to
  `compilerOptions`, but that is outside the scope of this issue.

## Performance notes

Measured manually in the demo at 10,000 rows:

- DOM node count for the list stays in the low tens regardless of dataset.
- Initial mount cost is dominated by `generateMockTasks(10_000)` (the
  generator), not by rendering — switching `size` toggles re-runs the
  generator, but the list itself mounts in a single frame.
- Scrolling through 10k rows is smooth on a mid-range laptop. The measured
  bottleneck during fast scroll is `measureElement` reflows, mitigated by
  the `overscan: 8` buffer.

These are qualitative observations from the demo, not benchmark numbers.
The follow-up issue that wires this to real data should add a Lighthouse /
React Profiler pass with real card content before declaring acceptance.

## Follow-ups for the next contributor

1. Replace `MockTask` with the real task type from the data layer once it
   exists; keep the `VirtualizedTaskList` API the same.
2. Add a context menu / row actions integration; `onSelect` is the natural
   hook.
3. Consider an end-to-end test (Playwright) that actually scrolls and
   asserts only a windowed slice of rows is in the DOM at any time.
4. If the design ever calls for grouped rows (e.g. status headers),
   `useVirtualizer` supports it via `getItemKey` + a discriminated row type
   — wrap that pattern rather than introducing a second virtualization
   library.
