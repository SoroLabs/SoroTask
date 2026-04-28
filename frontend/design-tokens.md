# Design Tokens

This document describes the design token system used in the SoroTask frontend. Design tokens are the visual design atoms of our system — they represent the foundational decisions of our visual design.

## Overview

Design tokens are stored in two places:

1. **`app/design-tokens.css`** — CSS custom properties (CSS variables) that define all token values
2. **`tailwind.config.js`** — Tailwind CSS configuration that maps to our token system

## Why Design Tokens?

- **Consistency**: Ensure consistent spacing, colors, and typography across the application
- **Maintainability**: Update values in one place to affect the entire application
- **Theming**: Easy dark/light mode support through CSS variable overrides
- **Developer Experience**: Clear, semantic names instead of hard-coded values

## Token Categories

### Color Tokens

Colors are defined as CSS custom properties in `:root` (light mode) and `@media (prefers-color-scheme: dark)` (dark mode).

#### Semantic Colors

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--color-background` | `#ffffff` | `#0a0a0a` | Page backgrounds |
| `--color-foreground` | `#171717` | `#ededed` | Primary text |
| `--color-foreground-muted` | `#737373` | `#a3a3a3` | Secondary text |
| `--color-surface` | `#ffffff` | `#171717` | Card backgrounds |
| `--color-surface-alt` | `#f9fafb` | `#262626` | Alternate surfaces |

#### Brand Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#3b82f6` | Primary actions, links |
| `--color-primary-hover` | `#2563eb` | Hover states |
| `--color-primary-active` | `#1d4ed8` | Active states |
| `--color-primary-subtle` | `#eff6ff` | Background accents |

#### Semantic Status Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` | `#10b981` | Success states |
| `--color-warning` | `#f59e0b` | Warning states |
| `--color-error` | `#ef4444` | Error states |
| `--color-info` | `#0ea5e9` | Informational states |

#### Neutral Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--color-neutral-50` | `#f9fafb` | Light backgrounds |
| `--color-neutral-100` | `#f3f4f6` | Subtle backgrounds |
| `--color-neutral-200` | `#e5e7eb` | Borders |
| `--color-neutral-300` | `#d1d5db` | Disabled states |
| `--color-neutral-400` | `#9ca3af` | Muted text |
| `--color-neutral-500` | `#737373` | Secondary text |
| `--color-neutral-600` | `#525252` | Body text (dark) |
| `--color-neutral-700` | `#404040` | Headings (dark) |
| `--color-neutral-800` | `#262626` | Dark backgrounds |
| `--color-neutral-900` | `#171717` | Dark foregrounds |
| `--color-neutral-950` | `#0a0a0a` | Dark page backgrounds |

### Spacing Tokens

Spacing is based on a 4px grid system.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xxs` | `0.125rem` (2px) | Minimal spacing |
| `--space-xs` | `0.25rem` (4px) | Small spacing |
| `--space-sm` | `0.5rem` (8px) | Small padding/margin |
| `--space-md` | `1rem` (16px) | Medium spacing |
| `--space-lg` | `1.5rem` (24px) | Large spacing |
| `--space-xl` | `2rem` (32px) | Extra large spacing |
| `--space-2xl` | `3rem` (48px) | Section spacing |
| `--space-3xl` | `4rem` (64px) | Hero spacing |

### Typography Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--font-family-sans` | System sans-serif stack | UI text |
| `--font-family-mono` | System monospace stack | Code, addresses |
| `--font-size-xs` | `0.75rem` | Tiny text |
| `--font-size-sm` | `0.875rem` | Small text |
| `--font-size-base` | `1rem` | Body text |
| `--font-size-lg` | `1.125rem` | Large text |
| `--font-size-xl` | `1.25rem` | Headings |
| `--font-weight-regular` | `400` | Regular text |
| `--font-weight-medium` | `500` | Medium emphasis |
| `--font-weight-bold` | `700` | Strong emphasis |

### Border Radius Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `0.25rem` | Small radius |
| `--radius-md` | `0.375rem` | Medium radius |
| `--radius-lg` | `0.5rem` | Large radius |
| `--radius-xl` | `0.75rem` | Extra large radius |
| `--radius-full` | `9999px` | Pill shape |

### Shadow Tokens

| Token | Usage |
|-------|-------|
| `--shadow-sm` | Subtle shadows |
| `--shadow-md` | Medium shadows |
| `--shadow-lg` | Large shadows |
| `--shadow-xl` | Extra large shadows |
| `--shadow-primary` | Primary color shadows |

### Border Width Tokens

| Token | Value |
|-------|-------|
| `--border-width` | `1px` |
| `--border-width-strong` | `2px` |

### Transition Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--transition-fast` | `150ms` | Quick transitions |
| `--transition-normal` | `250ms` | Standard transitions |
| `--transition-slow` | `350ms` | Slow transitions |

## Component Token Mappings

Components map semantic tokens to specific usage patterns:

### Button Component

```css
.btn {
  --btn-padding-x: var(--space-inset-md);
  --btn-padding-y: var(--space-inset-sm);
  --btn-border-radius: var(--radius-md);
  --btn-font-weight: var(--font-weight-medium);
}
```

### Card Component

```css
.card {
  --card-bg: var(--color-surface-card);
  --card-border: var(--color-border);
  --card-border-radius: var(--radius-xl);
  --card-padding: var(--space-inset-xl);
  --card-shadow: var(--shadow-lg);
}
```

### Input Component

```css
.input {
  --input-bg: var(--color-surface);
  --input-border: var(--color-border);
  --input-border-focus: var(--color-primary);
  --input-border-radius: var(--radius-lg);
}
```

## Usage Guidelines

### ✅ DO

- **Use semantic token names**: Prefer `--color-primary` over `--color-blue-500`
- **Use CSS variables in components**: Reference tokens via `var(--token-name)`
- **Follow the spacing scale**: Use spacing tokens instead of arbitrary values
- **Use Tailwind classes when possible**: They're mapped to our token system

### ❌ DON'T

- **Hard-code values**: Avoid `#3b82f6`, `16px`, `0.5rem` in component code
- **Use arbitrary Tailwind values**: Avoid `bg-[#3b82f6]`, `p-[16px]`
- **Create new tokens unnecessarily**: Reuse existing tokens before creating new ones
- **Override tokens inline**: Use CSS classes instead of inline styles

## Examples

### Good: Using Design Tokens

```tsx
// Using the Button component (recommended)
<Button variant="primary" size="md">
  Click me
</Button>

// Using Tailwind classes mapped to tokens
<div className="bg-background text-foreground p-6">
  <h1 className="text-xl font-bold">Title</h1>
</div>

// Using CSS variables directly
<div style={{
  backgroundColor: 'var(--color-surface)',
  padding: 'var(--space-lg)',
  borderRadius: 'var(--radius-lg)'
}}>
  Content
</div>
```

### Bad: Hard-coded Values

```tsx
// ❌ Avoid hard-coded values
<button style={{
  backgroundColor: '#3b82f6',  // Hard-coded color
  padding: '8px 16px',          // Hard-coded spacing
  borderRadius: '6px'           // Hard-coded radius
}}>
  Click me
</button>

// ❌ Avoid arbitrary Tailwind values
<div className="bg-[#171717] p-[24px] rounded-[12px]">
  Content
</div>
```

## Adding New Tokens

1. **Consider if needed**: Can you reuse an existing token?
2. **Add to `design-tokens.css`**: Define in the appropriate section
3. **Add to `tailwind.config.js`**: If needed for Tailwind classes
4. **Document here**: Add to this document
5. **Update components**: Use the new token in relevant components

## Dark Mode

Dark mode is automatically applied based on the user's system preference. Tokens in the `@media (prefers-color-scheme: dark)` block override light mode values.

To force a theme, add `data-theme="light"` or `data-theme="dark"` to the `<html>` element.

## Migration from Hard-coded Values

When refactoring code to use design tokens:

1. Identify hard-coded values (colors, spacing, typography)
2. Find the matching design token
3. Replace with `var(--token-name)` or Tailwind class
4. Test in both light and dark modes
5. Verify visual consistency

## Resources

- [Tailwind CSS Configuration](tailwind.config.js)
- [Design Tokens CSS](app/design-tokens.css)
- [Component Library](app/components/)