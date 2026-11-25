"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaRegistration() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosInstallHelp, setIosInstallHelp] = useState(false);
  const [serviceWorkerReady, setServiceWorkerReady] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setIosInstallHelp(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator && navigator.standalone === true),
    );
    const wantsServiceWorker =
      process.env.NEXT_PUBLIC_DISABLE_SW !== "true" &&
      "serviceWorker" in navigator &&
      (process.env.NODE_ENV === "production" ||
        process.env.NEXT_PUBLIC_ENABLE_SW_IN_DEV === "true");
    let mounted = true;
    if (wantsServiceWorker) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(() => navigator.serviceWorker.ready)
        .then(() => {
          if (mounted) setServiceWorkerReady(true);
        })
        .catch((error: unknown) => {
          console.error("Failed to register SoroTask service worker.", error);
          if (mounted) setNotice("Offline support could not be enabled in this browser.");
        });
    }

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setNotice("SoroTask was added to your device.");
    };
    const handleMessage = (
      event: MessageEvent<{ type?: string; status?: number }>,
    ) => {
      if (event.data?.type === "BACKGROUND_REQUEST_FAILED") {
        setNotice(
          `An offline change could not be synchronized (HTTP ${event.data.status ?? "error"}). Review it in the app.`,
        );
      } else if (event.data?.type === "BACKGROUND_REQUEST_COMPLETED") {
        setNotice("An offline change was synchronized.");
      }
    };
    const handleOnline = () => {
      if (!("serviceWorker" in navigator)) return;
      void navigator.serviceWorker.ready
        .then((registration) => {
          registration.active?.postMessage({ type: "FLUSH_BACKGROUND_REQUESTS" });
        })
        .catch((error: unknown) => {
          console.error("Failed to retry queued offline changes.", error);
        });
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleMessage);
      window.addEventListener("online", handleOnline);
    }

    return () => {
      mounted = false;
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleMessage);
        window.removeEventListener("online", handleOnline);
      }
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
    } catch (error) {
      console.error("Failed to show the SoroTask install prompt.", error);
      setNotice("Could not open the install prompt. Use your browser menu to install SoroTask.");
      setInstallPrompt(null);
    }
  };

  const enableNotifications = async () => {
    if (!("Notification" in window)) {
      setNotice("Notifications are not supported by this browser.");
      return;
    }
    if (!serviceWorkerReady) {
      setNotice("Wait for offline support to finish setting up, then try again.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotice(
        permission === "granted"
          ? "Notifications enabled. Server-side push delivery still needs to be configured."
          : "Notification permission was not granted.",
      );
    } catch (error) {
      console.error("Failed to request notification permission.", error);
      setNotice("Could not request notification permission.");
    }
  };

  return (
    <aside className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {notice && (
        <p role="status" className="max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 shadow-lg">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {!installed && installPrompt && (
          <button
            type="button"
            onClick={install}
            className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-lg hover:bg-blue-400"
          >
            Install SoroTask
          </button>
        )}
        {!installed && iosInstallHelp && !installPrompt && (
          <p className="max-w-64 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 shadow-lg">
            To install on iPhone or iPad, tap Share, then “Add to Home Screen”.
          </p>
        )}
        {serviceWorkerReady && typeof Notification !== "undefined" && (
          <button
            type="button"
            onClick={enableNotifications}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-200 shadow-lg hover:bg-neutral-800"
          >
            Enable alerts
          </button>
        )}
      </div>
    </aside>
  );
}
