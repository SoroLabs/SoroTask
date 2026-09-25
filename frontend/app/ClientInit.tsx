"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { instrumentFetch } from "@/src/lib/errors/fetchTracker";
import { SYNC_TAG } from "@/src/lib/offline/backgroundSync";

/** Custom event used to hand a Background Sync trigger to the page. */
export const REPLAY_QUEUE_EVENT = "sorotask:replay-queue";

export function ClientInit() {
  useEffect(() => {
    // Sentry is initialized in sentry.client.config.ts
    instrumentFetch();

    // Issue #1240: register the offline-first service worker. Caching is
    // implemented directly in public/sw.js (app shell, static assets and
    // read-only task queries) with a graceful /offline fallback.
    //
    // Registration is not gated on NODE_ENV: the SW only ever caches
    // same-origin GETs, and gating it meant the offline path could not be
    // exercised outside a production build. The dev opt-in below keeps HMR
    // safe for anyone who does not want it locally.
    const wantsServiceWorker =
      process.env.NEXT_PUBLIC_DISABLE_SW !== "true" &&
      "serviceWorker" in navigator &&
      (process.env.NODE_ENV === "production" ||
        process.env.NEXT_PUBLIC_ENABLE_SW_IN_DEV === "true");

    if (!wantsServiceWorker) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
      Sentry.captureException?.(err);
    });

    // The SW cannot replay writes by itself — the pending queue lives in
    // IndexedDB behind a typed API owned by OfflineSyncProvider. So when the
    // browser reports Background Sync, the SW posts a message here and the
    // page emits REPLAY_QUEUE_EVENT, which the provider subscribes to.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === SYNC_TAG) {
        window.dispatchEvent(new CustomEvent(REPLAY_QUEUE_EVENT));
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  return null;
}
