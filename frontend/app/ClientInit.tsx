"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { instrumentFetch } from "@/src/lib/errors/fetchTracker";

export function ClientInit() {
  useEffect(() => {
// Sentry is initialized in sentry.client.config.ts
    instrumentFetch();

    // Issue #811: register the offline-first service worker (production only so
    // dev HMR and local iteration are never byte-cached). Workbox caching is
    // implemented directly in public/sw.js (static assets, fonts, and read-only
    // task queries) with a graceful /offline fallback.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    }
  }, []);
  return null;
}
