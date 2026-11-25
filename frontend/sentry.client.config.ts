import * as Sentry from "@sentry/nextjs";

import { scrubEvent } from "@/src/lib/observability/scrubber";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Session Replay. Enabled so a crash has reproduction context, but only
    // under the masking below — an unmasked replay of a wallet screen is a
    // video recording of a secret key being typed.
    replaysSessionSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 0,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Text and media are masked wholesale rather than by selector. An
        // allow-list would need every future screen to be audited before it
        // ships; this fails safe for screens nobody has looked at yet.
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
        // Network bodies are never captured — a signing request body is the
        // single worst thing that could end up in a replay.
        networkDetailAllowUrls: [],
      }),
    ],

    // Every outbound event passes through the value-level scrubber
    // (Issue #1258). Returning null drops the event, which is what the
    // scrubber does if it fails — see "fail closed" in scrubber.ts.
    beforeSend(event) {
      return scrubEvent(event as never) as never;
    },

    // Breadcrumbs are the highest-risk field: console output, fetch URLs and
    // click targets from the seconds before the crash.
    beforeBreadcrumb(breadcrumb) {
      const scrubbed = scrubEvent({ breadcrumbs: [breadcrumb as never] } as never) as
        | { breadcrumbs?: unknown[] }
        | null;
      return (scrubbed?.breadcrumbs?.[0] ?? null) as never;
    },

    ignoreErrors: [
      "top.GLOBALS",
      "iframe.*",
      "Non-Error promise rejection captured",
      "chrome-extension://*",
      "Warning:.*",
      // Browser extensions injecting into the page — noise, not our bugs.
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
    ],

    // Sending the URL of a page the user is on is fine; sending the query
    // string is not, and the scrubber handles that in `request.url`.
    sendDefaultPii: false,

    debug: process.env.NODE_ENV === "development" && process.env.SENTRY_DEBUG === "true",
  });
}
