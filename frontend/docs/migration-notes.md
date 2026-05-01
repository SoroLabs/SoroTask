# Frontend Migration Notes

## Stack Versions (as of April 2026)

| Package | Version |
|---|---|
| Next.js | 16.2.1 |
| React | 19.2.4 |
| TypeScript | ^6 (6.0, released March 2026) |
| Tailwind CSS | ^4 |
| ESLint | ^10 |

---

## Breaking Changes Resolved

### Next.js 16

#### `next lint` command removed
Next.js 16 removed the `next lint` CLI command. The `lint` script in `package.json` now calls `eslint .` directly, which is the correct approach. ESLint v10 (flat config) is used.

#### `babel-plugin-react-compiler` removed from devDependencies
React Compiler support is now **stable and built into Next.js 16** — no separate Babel plugin is needed. The `babel-plugin-react-compiler` devDependency has been removed from `package.json`. The `reactCompiler: true` flag in `next.config.ts` is all that's required.

#### Turbopack is now the default bundler
Next.js 16 uses Turbopack by default for `next dev` and `next build`. No configuration change is needed. To opt out: `next build --webpack`.

#### Async `params` and `searchParams`
In Next.js 16, `params` and `searchParams` props in page/layout components are now **Promises** and must be awaited:
```tsx
// Before (Next.js 15 and earlier)
export default function Page({ params }: { params: { id: string } }) { ... }

// After (Next.js 16)
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  ...
}
```
This project has no dynamic routes yet, so no changes were needed. Apply this pattern when adding `[slug]` or `[id]` routes.

#### `cookies()`, `headers()`, `draftMode()` are now async
```tsx
// Before
import { cookies } from 'next/headers'
const cookieStore = cookies()

// After
import { cookies } from 'next/headers'
const cookieStore = await cookies()
```

#### `middleware.ts` deprecated → `proxy.ts`
`middleware.ts` is deprecated in Next.js 16. The replacement is `proxy.ts` with an exported `proxy` function. This project has no middleware yet — use `proxy.ts` when adding request interception logic.

#### `revalidateTag()` signature changed
`revalidateTag()` now requires a `cacheLife` profile as the second argument:
```ts
// Before
revalidateTag('my-tag')

// After
revalidateTag('my-tag', 'max')
```

#### Image optimisation defaults changed
- `minimumCacheTTL`: 60s → 14400s (4 hours)
- `imageSizes`: `16` removed from defaults
- `qualities`: `[1..100]` → `[75]`

These are intentional improvements. No override needed unless you have specific requirements.

#### Parallel routes require explicit `default.js`
If you add parallel routes (`@slot` directories), each slot now requires an explicit `default.js` file. Without it, the build will fail. Return `null` or call `notFound()` from `default.js`.

---

### TypeScript 6

TypeScript 6.0 shipped on March 23, 2026. Key changes affecting this project:

#### `target` updated from `ES2017` → `ES2022`
TypeScript 6 defaults `target` to the current-year ES version (effectively `es2025`). We pin to `ES2022` explicitly for broad compatibility while still supporting modern syntax. Update this as browser support requirements evolve.

#### `strict` is now `true` by default
TypeScript 6 enables `strict: true` by default. This project already had it set explicitly — no change needed. New contributors should be aware that strict mode is always on.

#### `module` defaults to `esnext`
Already set explicitly in `tsconfig.json`. No change needed.

#### `dom.iterable` is now included in `dom`
As of TypeScript 6, `lib.dom.iterable.d.ts` is merged into `lib.dom.d.ts`. The `"dom.iterable"` entry in the `lib` array is now a no-op (empty file). It's kept in `tsconfig.json` for clarity but can be removed.

#### `.next/dev/types/**/*.ts` added to `include`
Next.js 16 generates additional type declarations in `.next/dev/types/`. This path is now included in `tsconfig.json`.

---

### Jest / Testing

#### `jest.config.js` — async pattern fixed
The previous config used `async/await` with `nextJest`, which caused `module.exports` to receive a `Promise` instead of the resolved config object. In Next.js 16, `nextJest()` is called synchronously:
```js
// Before (broken — exports a Promise)
const createJestConfig = async () => {
  const nextConfig = await nextJest({ dir: './' })
  return nextConfig({ ... })
}
module.exports = createJestConfig()

// After (correct)
const createJestConfig = nextJest({ dir: './' })
module.exports = createJestConfig({ ... })
```

#### `moduleNameMapper` fixed — `src/` → project root
The previous config mapped `@/*` to `<rootDir>/src/$1`, but this project uses the App Router with files in `app/` (no `src/` directory). The alias now maps to `<rootDir>/$1`, matching `tsconfig.json`'s `"@/*": ["./*"]`.

#### `collectCoverageFrom` fixed — `src/` → `app/`
Coverage collection now targets `app/**/*.{js,jsx,ts,tsx}` instead of the non-existent `src/` directory.

#### `jest.setup.js` — `next/router` → `next/navigation`
The App Router uses `next/navigation`, not `next/router` (which is Pages Router only). The mock has been updated:
```js
// Before (Pages Router — wrong for App Router projects)
jest.mock('next/router', () => ({ useRouter() { ... } }))

// After (App Router)
jest.mock('next/navigation', () => ({
  useRouter() { ... },
  usePathname() { ... },
  useSearchParams() { ... },
  useParams() { ... },
  redirect: jest.fn(),
  notFound: jest.fn(),
}))
```

---

### ESLint v10

ESLint v10 drops support for the legacy `.eslintrc` format. This project already uses the flat config format (`eslint.config.mjs`) — no changes needed.

`eslint-config-next` 16.2.1 exports flat config arrays via `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`, which are spread directly into the config array. This is the correct pattern.

---

### Tailwind CSS v4

Tailwind v4 uses `@import "tailwindcss"` instead of the v3 `@tailwind base/components/utilities` directives. The `globals.css` already uses the v4 syntax. PostCSS is configured via `@tailwindcss/postcss` in `postcss.config.mjs`.

The `tailwind.config.js` file is **not needed** in Tailwind v4 — configuration is done via CSS `@theme` blocks in `globals.css`.

---

## Key Patterns for New Contributors

### App Router conventions
- All pages live in `app/` — no `pages/` directory.
- Server Components are the default. Add `'use client'` only when you need browser APIs, event handlers, or React hooks.
- Use `next/navigation` (not `next/router`) for programmatic navigation.
- Dynamic route params are Promises in Next.js 16 — always `await params`.

### Path aliases
`@/` maps to the project root. Example:
```tsx
import { MyComponent } from '@/app/components/MyComponent'
```

### Running tests
```bash
npm test              # run all tests once
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

### Linting
```bash
npm run lint          # ESLint v10 flat config
```
