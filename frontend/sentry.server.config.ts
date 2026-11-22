import * as Sentry from "@sentry/nextjs";

import { scrubEvent } from "@/src/lib/observability/scrubber";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,

    // Same value-level scrubber as the client (Issue #1258). The server sees
    // request bodies the browser never does, so the key-name-only filter this
    // replaced was an even weaker guarantee here.
    beforeSend(event) {
      return scrubEvent(event as never) as never;
    },

    beforeBreadcrumb(breadcrumb) {
      const scrubbed = scrubEvent({ breadcrumbs: [breadcrumb as never] } as never) as
        | { breadcrumbs?: unknown[] }
        | null;
      return (scrubbed?.breadcrumbs?.[0] ?? null) as never;
    },
  });
}
