# SoroTask Frontend

This frontend now includes a lightweight performance monitoring layer focused on the interactions that matter most in task operations.

## Measured interaction paths

- Route readiness for the main task board
- Task detail open latency
- Search responsiveness
- Task mutation responsiveness for pause, resume, and refill actions
- Media rendering for avatars and task previews on card-heavy screens

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and interact with the dashboard to generate local performance samples.

## Environment flags

- `NEXT_PUBLIC_PERF_SAMPLE_RATE`
  Controls how many interaction events are recorded. Defaults to `1`.
- `NEXT_PUBLIC_PERF_DEBUG`
  Set to `1` to mirror sampled metrics to the browser console.
- `NEXT_PUBLIC_KEEPER_URL`
  Set this to the absolute HTTP(S) URL of the deployed keeper. Its HTTP and
  WebSocket origins are added to the runtime Content Security Policy
  `connect-src` directive. Production deployments should not rely on the
  development `localhost:3000` default.

## Browser security policy

- Middleware generates a fresh cryptographic nonce for each page request and
  forwards a nonce-based CSP to Next.js. Inline scripts are denied unless they
  carry that nonce; the early theme script uses it as well.
- CSP disallows framing, plugins, inline event handlers, and untrusted script
  origins. Add only required service origins to the CSP helper when integrating
  another browser-side service.
- Static security headers include HSTS, `X-Frame-Options: DENY`, MIME
  sniffing protection, a strict referrer policy, and a restrictive
  Permissions Policy.
- There are no third-party script tags in the app. If one is introduced, pin it
  with Subresource Integrity and `crossOrigin="anonymous"`; do not broaden the
  script CSP to allow its host.
- Rich-text HTML is sanitized with DOMPurify before it reaches
  `dangerouslySetInnerHTML`. Other user-provided values should remain rendered
  as React text rather than being converted to HTML.

The policy permits inline style attributes for existing UI components; this
does not permit inline scripts. Validate the deployed response headers and
wallet, OAuth, and keeper integrations in the target environment before
enabling the policy in production.

## Progressive web app

- `/manifest.json` supplies install metadata and app icons. The service worker
  precaches the offline page and icons, uses network-first navigation without
  caching authenticated HTML, and caches same-origin Next.js static assets.
- `queueBackgroundRequest` in `lib/pwa.ts` stores same-origin `/api/` writes in
  IndexedDB for Background Sync. Callers must provide unique request IDs; the
  target API must support replay/idempotency. Requests are discarded on
  non-retryable client errors and retained on transient/server errors.
- The service worker can display Web Push payloads while the app is closed,
  but push delivery requires a server to manage VAPID subscriptions and send
  pushes. This repository does not yet provide that sender/subscription API.
- iOS installation uses Safari’s Share → Add to Home Screen flow. Push
  notifications on iOS require an installed web app and supported iOS version.

## Reporting model

- Metrics are buffered in memory on `window.__SOROTASK_PERF_METRICS__`.
- Each sampled metric is emitted as `sorotask:performance-metric`.
- No network reporting is performed automatically, which keeps the instrumentation cheap and easy to route into a future analytics pipeline.

## Docs

Implementation and interpretation guidance lives in [docs/performance-monitoring.md](./docs/performance-monitoring.md).
Media rendering patterns for contributors live in [docs/media-rendering.md](./docs/media-rendering.md).
