"use client";

import { useEffect, useState } from "react";

export interface OnlineStatus {
  online: boolean;
  // Timestamp of the most recent transition. Null until the first
  // transition is observed. Useful for "we've been offline since…" UX.
  lastChangeAt: number | null;
}

// Server-render with `online: true`. Browsers that lie about offline
// (captive portals, blackholed networks) will still report `true` even
// after mount — this is documented in the spike doc as a known limitation.
const SSR_DEFAULT: OnlineStatus = { online: true, lastChangeAt: null };

function readNow(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>(SSR_DEFAULT);

  useEffect(() => {
    // Sync once on mount in case the SSR default is wrong.
    const initial = readNow();
    setStatus((prev) =>
      prev.online === initial && prev.lastChangeAt !== null
        ? prev
        : { online: initial, lastChangeAt: prev.lastChangeAt },
    );

    const handleOnline = () =>
      setStatus({ online: true, lastChangeAt: Date.now() });
    const handleOffline = () =>
      setStatus({ online: false, lastChangeAt: Date.now() });

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return status;
}
