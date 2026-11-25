import * as Sentry from "@sentry/nextjs";

import { scrubEvent } from "@/src/lib/observability/scrubber";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,

    // The edge runtime sees auth headers on every request it proxies, so it
    // gets the same scrubber as client and server (Issue #1258).
    beforeSend(event) {
      return scrubEvent(event as never) as never;
    },
  });
}
