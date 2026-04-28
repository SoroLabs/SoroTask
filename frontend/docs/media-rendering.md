# Media Rendering Guide

SoroTask uses a shared `OptimizedMedia` component for avatars, task previews, and attachment-like thumbnails on task-heavy screens.

## Goals

- Keep image payloads cheap by using Next.js image rendering.
- Prevent layout shift by always reserving width, height, and aspect ratio.
- Lazy load non-critical media so list-heavy screens stay responsive.
- Fail safely when media is missing, empty, or broken.

## Standard pattern

Use [`src/components/optimized-media.tsx`](../src/components/optimized-media.tsx) instead of hand-written `<img>` tags when rendering frontend media.

```tsx
<OptimizedMedia
  alt="Treasury avatar"
  src={task.ownerAvatar}
  width={72}
  height={72}
  sizes="72px"
  rounded="full"
  fallbackLabel="TO"
/>
```

## Contributor checklist

- Provide explicit `width` and `height`.
- Provide a realistic `sizes` value for responsive layouts.
- Use `priority` only for media that is above the fold on initial render.
- Prefer lazy loading for task lists, drawers, feeds, and galleries.
- Always provide a short `fallbackLabel` so broken media still communicates something useful.
- Report important media surfaces through the performance monitor when they affect task UX.

## Measuring task-heavy screens

The task dashboard records `media_render` samples alongside route, search, task-open, and mutation timings.

- `state=loaded` means the image finished rendering successfully.
- `state=fallback` means the reserved frame protected the layout and the UI switched to a fallback.
- Compare `p50` and `p95` on screens with lots of cards to catch regressions in image-heavy rendering paths.
