"use client";

import { signMessage } from "@stellar/freighter-api";
import { useWallet } from "@/app/context/WalletContext";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  defaultNotificationPreferences,
  getActiveDeliveryChannels,
  getBlockedDeliveryChannels,
  getBrowserPermissionState,
  notificationCategories,
  type BrowserPermissionState,
  type NotificationCategoryDefinition,
  type NotificationCategoryId,
  type NotificationChannel,
  type NotificationPreferences,
} from "../lib/notification-preferences";
import {
  type ExternalChannelId,
} from "../lib/notification-secrets";

type SimulationEntry = {
  id: number;
  categoryId: NotificationCategoryId;
  title: string;
  channels: NotificationChannel[];
  blockedChannels: NotificationChannel[];
  createdAt: string;
};

type DeliveredNotification = {
  id: string;
  type: NotificationCategoryId;
  title: string;
  message: string;
  url: string;
  timestamp: string;
};

const channelCopy: Record<
  NotificationChannel,
  {
    label: string;
    description: string;
  }
> = {
  inApp: {
    label: "In-app feed",
    description: "Keep a live history inside SoroTask for operators and teams.",
  },
  browser: {
    label: "Browser push",
    description:
      "Receive service-worker push alerts when this browser is closed.",
  },
  email: {
    label: "Email summaries",
    description: "Deliver important alerts and digests outside the app.",
  },
  webhook: {
    label: "Webhook",
    description: "POST execution alerts to your own HTTP endpoint.",
  },
  telegram: {
    label: "Telegram bot",
    description: "Deliver alerts through a Telegram bot sendMessage URL.",
  },
  discord: {
    label: "Discord webhook",
    description: "Deliver alerts into a Discord channel webhook.",
  },
};

const permissionTone: Record<
  BrowserPermissionState,
  {
    label: string;
    detail: string;
    className: string;
  }
> = {
  granted: {
    label: "Browser alerts are enabled",
    detail: "Desktop notifications can be delivered right away.",
    className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  },
  denied: {
    label: "Browser alerts are blocked",
    detail:
      "Open your browser site settings for this app and allow notifications to recover delivery.",
    className: "border-rose-400/30 bg-rose-500/10 text-rose-100",
  },
  default: {
    label: "Browser permission still needs a decision",
    detail:
      "Request permission once you are ready to receive real-time task alerts.",
    className: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  },
  unsupported: {
    label: "Browser notifications are unavailable",
    detail:
      "This environment does not expose the Notifications API, so SoroTask will fall back to other channels.",
    className: "border-white/15 bg-white/5 text-slate-100",
  },
};

const simulationMessages: Record<NotificationCategoryId, string> = {
  taskFailed: "Task #1048 failed during its last keeper run.",
  taskRecovered: "Task #1048 recovered after the latest retry.",
  gasLow: "Task #212 has less than 20% gas remaining.",
  taskPaused: "Task #333 was paused because its contract target rejected execution.",
  executionSuccess: "Task #501 completed its scheduled execution successfully.",
  executionSkipped: "Task #902 was skipped because its interval window shifted.",
  weeklyDigest: "Your weekly digest is ready with uptime, gas, and skip trends.",
};

function formatRelativeTimestamp(value: string | null): string {
  if (!value) {
    return "Not saved yet";
  }

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return "Saved recently";
  }

  const diffMinutes = Math.max(
    0,
    Math.round((Date.now() - time) / (1000 * 60)),
  );

  if (diffMinutes < 1) {
    return "Saved just now";
  }

  if (diffMinutes < 60) {
    return `Saved ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  return `Saved ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
}

function buildSimulationEntry(
  preferences: NotificationPreferences,
  category: NotificationCategoryDefinition,
  permission: BrowserPermissionState,
): SimulationEntry {
  return {
    id: Date.now(),
    categoryId: category.id,
    title: simulationMessages[category.id],
    channels: getActiveDeliveryChannels(preferences, category.id, permission),
    blockedChannels: getBlockedDeliveryChannels(preferences, permission),
    createdAt: new Date().toISOString(),
  };
}

function decodeVapidPublicKey(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

function encodeSignature(value: string | Uint8Array): string {
  if (typeof value === "string") return value;
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

export function NotificationPreferenceCenter() {
  const wallet = useWallet();
  const [draft, setDraft] = useState<NotificationPreferences>(
    defaultNotificationPreferences,
  );
  const [saved, setSaved] = useState<NotificationPreferences>(
    defaultNotificationPreferences,
  );
  const [permission, setPermission] = useState<BrowserPermissionState>(
    "unsupported",
  );
  const [saveMessage, setSaveMessage] = useState("No unsaved changes");
  const [simulationFeed, setSimulationFeed] = useState<SimulationEntry[]>([]);
  const [deliveredFeed, setDeliveredFeed] = useState<DeliveredNotification[]>([]);
  const [isSaving, startTransition] = useTransition();
  const [linkedAddress, setLinkedAddress] = useState<string | null>(null);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [externalSecretsConfigured, setExternalSecretsConfigured] = useState<
    Record<ExternalChannelId, boolean>
  >({ webhook: false, telegram: false, discord: false });
  const [externalEndpointDrafts, setExternalEndpointDrafts] = useState<
    Record<ExternalChannelId, { url: string; secret: string }>
  >({ webhook: { url: "", secret: "" }, telegram: { url: "", secret: "" }, discord: { url: "", secret: "" } });
  const [pingResults, setPingResults] = useState<
    Partial<Record<ExternalChannelId, { ok: boolean; detail: string }>>
  >({});

  const loadServerPreferences = useCallback(async () => {
    const response = await fetch("/api/notifications/preferences", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Unable to load notification preferences");
    }
    const preferences = (await response.json()) as NotificationPreferences & {
      externalSecretsConfigured: Record<ExternalChannelId, boolean>;
    };
    setDraft(preferences);
    setSaved(preferences);
    setExternalSecretsConfigured(preferences.externalSecretsConfigured);
    setExternalEndpointDrafts({
      webhook: { url: preferences.externalEndpoints.webhook.url, secret: "" },
      telegram: { url: preferences.externalEndpoints.telegram.url, secret: "" },
      discord: { url: preferences.externalEndpoints.discord.url, secret: "" },
    });
    setSaveMessage(
      preferences.updatedAt ? "Preferences loaded" : "Using smart defaults",
    );
  }, []);

  const loadDeliveredFeed = useCallback(async () => {
    const response = await fetch("/api/notifications/feed", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Unable to load recent notifications");
    }
    setDeliveredFeed((await response.json()) as DeliveredNotification[]);
  }, []);

  useEffect(() => {
    setPermission(getBrowserPermissionState());
  }, []);

  useEffect(() => {
    if (!wallet.session?.address) return;
    let active = true;
    void fetch("/api/notifications/wallet-session", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { address?: string };
      })
      .then(async (session) => {
        if (!active || !session?.address) return;
        if (session.address !== wallet.session?.address) {
          await fetch("/api/notifications/wallet-session", {
            method: "DELETE",
            credentials: "same-origin",
          });
          return;
        }
        setLinkedAddress(session.address);
        await loadServerPreferences();
        await loadDeliveredFeed();
        const registration = await navigator.serviceWorker?.getRegistration("/");
        setPushSubscribed(
          Boolean(
            getBrowserPermissionState() === "granted" &&
              (await registration?.pushManager.getSubscription()),
          ),
        );
      })
      .catch((error: unknown) => {
        if (active) {
          setSaveMessage(
            error instanceof Error ? error.message : "Unable to restore notification wallet",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [wallet.session?.address, loadServerPreferences, loadDeliveredFeed]);

  useEffect(() => {
    if (wallet.session || wallet.status !== "disconnected") return;
    void fetch("/api/notifications/wallet-session", {
      method: "DELETE",
      credentials: "same-origin",
    })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to revoke notification session");
      })
      .catch((error: unknown) => {
        setSaveMessage(
          error instanceof Error ? error.message : "Unable to revoke notification session",
        );
      });
  }, [wallet.session, wallet.status]);

  useEffect(() => {
    const syncPermission = () => setPermission(getBrowserPermissionState());

    syncPermission();
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);

    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, []);

  const dirty =
    JSON.stringify(draft.channels) !== JSON.stringify(saved.channels) ||
    JSON.stringify(draft.categories) !== JSON.stringify(saved.categories) ||
    JSON.stringify(draft.categoryChannels) !==
      JSON.stringify(saved.categoryChannels) ||
    JSON.stringify(
      Object.fromEntries(
        Object.entries(draft.externalEndpoints).map(([channel, endpoint]) => [
          channel,
          endpoint.url,
        ]),
      ),
    ) !==
      JSON.stringify(
        Object.fromEntries(
          Object.entries(saved.externalEndpoints).map(([channel, endpoint]) => [
            channel,
            endpoint.url,
          ]),
        ),
      ) ||
    Object.values(externalEndpointDrafts).some((endpoint) => endpoint.secret) ||
    draft.emailAddress !== saved.emailAddress;

  const groupedCategories = useMemo(() => {
    return notificationCategories.reduce<
      Record<string, NotificationCategoryDefinition[]>
    >((accumulator, category) => {
      accumulator[category.group] ??= [];
      accumulator[category.group].push(category);
      return accumulator;
    }, {});
  }, []);

  const enabledCategoryCount = useMemo(() => {
    return Object.values(draft.categories).filter(Boolean).length;
  }, [draft.categories]);

  const enabledChannelCount = useMemo(() => {
    return Object.values(draft.channels).filter(Boolean).length;
  }, [draft.channels]);

  useEffect(() => {
    if (!linkedAddress || wallet.session?.address === linkedAddress) return;
    void fetch("/api/notifications/wallet-session", {
      method: "DELETE",
      credentials: "same-origin",
    });
    setLinkedAddress(null);
    setPushSubscribed(false);
    setDraft(defaultNotificationPreferences);
    setSaved(defaultNotificationPreferences);
    setDeliveredFeed([]);
    setExternalSecretsConfigured({ webhook: false, telegram: false, discord: false });
    setSaveMessage("Wallet disconnected; notification settings are not loaded");
  }, [linkedAddress, wallet.session?.address]);

  const connectNotificationWallet = async () => {
    if (!wallet.session) {
      wallet.openConnectModal();
      setSaveMessage("Connect a wallet to manage notification preferences");
      return;
    }
    setSaveMessage("Requesting a wallet signature...");
    try {
      const challengeResponse = await fetch("/api/notifications/wallet-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          address: wallet.session.address,
          networkPassphrase: wallet.session.network.networkPassphrase,
        }),
      });
      const challengeBody = (await challengeResponse.json()) as {
        challenge?: string;
        networkPassphrase?: string;
        error?: string;
      };
      if (!challengeResponse.ok || !challengeBody.challenge) {
        throw new Error(challengeBody.error ?? "Could not create wallet challenge");
      }

      const proof = await signMessage(challengeBody.challenge, {
        address: wallet.session.address,
        networkPassphrase: challengeBody.networkPassphrase,
      });
      if (proof.error || !proof.signedMessage || proof.signerAddress !== wallet.session.address) {
        throw new Error("Wallet signature was rejected or returned for another address");
      }

      const signatureResponse = await fetch("/api/notifications/wallet-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          address: wallet.session.address,
          challenge: challengeBody.challenge,
          signature: encodeSignature(proof.signedMessage),
        }),
      });
      const signatureBody = (await signatureResponse.json()) as { error?: string };
      if (!signatureResponse.ok) {
        throw new Error(signatureBody.error ?? "Wallet proof could not be verified");
      }

      setLinkedAddress(wallet.session.address);
      await loadServerPreferences();
      await loadDeliveredFeed();
      setSaveMessage("Wallet linked securely");
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Unable to link notification wallet",
      );
    }
  };

  const savePreferences = async () => {
    if (!linkedAddress) {
      setSaveMessage("Link your wallet before saving notification preferences");
      return;
    }
    startTransition(async () => {
      try {
        const draftToSave = {
          ...draft,
          externalEndpoints: {
            webhook: {
              ...draft.externalEndpoints.webhook,
              ...externalEndpointDrafts.webhook,
            },
            telegram: {
              ...draft.externalEndpoints.telegram,
              ...externalEndpointDrafts.telegram,
            },
            discord: {
              ...draft.externalEndpoints.discord,
              ...externalEndpointDrafts.discord,
            },
          },
        };
        const response = await fetch("/api/notifications/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(draftToSave),
        });
        const savedPreferences = (await response.json()) as NotificationPreferences & {
          externalSecretsConfigured?: Record<ExternalChannelId, boolean>;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(savedPreferences.error ?? "Unable to save notification preferences");
        }
        const next = savedPreferences;
        setDraft(next);
        setSaved(next);
        setExternalSecretsConfigured(
          savedPreferences.externalSecretsConfigured ?? externalSecretsConfigured,
        );
        setExternalEndpointDrafts({
          webhook: { url: next.externalEndpoints.webhook.url, secret: "" },
          telegram: { url: next.externalEndpoints.telegram.url, secret: "" },
          discord: { url: next.externalEndpoints.discord.url, secret: "" },
        });
        setSaveMessage("Preferences saved successfully");
      } catch (error) {
        setSaveMessage(
          error instanceof Error ? `Saving failed: ${error.message}` : "Saving failed. Please try again.",
        );
      }
    });
  };

  const runTestPing = async (channel: ExternalChannelId) => {
    const endpointDraft = externalEndpointDrafts[channel];
    setPingResults((current) => ({
      ...current,
      [channel]: { ok: false, detail: "Sending test ping..." },
    }));
    let result: { ok: boolean; status?: number; error?: string };
    try {
      const response = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ channel, ...endpointDraft }),
      });
      const body = (await response.json()) as { error?: string };
      result = response.ok
        ? { ok: true, status: response.status }
        : { ok: false, status: response.status, error: body.error };
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    setPingResults((current) => ({
      ...current,
      [channel]: {
        ok: result.ok,
        detail: result.ok
          ? `Test ping delivered${result.status ? ` (HTTP ${result.status})` : ""}`
          : `Test ping failed: ${result.error ?? `HTTP ${result.status ?? "error"}`}`,
      },
    }));
  };

  const toggleCategoryChannel = (
    category: NotificationCategoryId,
    channel: NotificationChannel,
  ) => {
    setDraft((current) => {
      const override = current.categoryChannels[category];
      const channels = new Set(override ?? []);
      if (channels.has(channel)) {
        channels.delete(channel);
      } else {
        channels.add(channel);
      }
      // An empty override clears back to global routing.
      return {
        ...current,
        categoryChannels: {
          ...current.categoryChannels,
          [category]: channels.size > 0 ? [...channels] : undefined,
        },
      };
    });
    setSaveMessage("Unsaved changes ready");
  };

  const requestPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }

    if (!linkedAddress) {
      setSaveMessage("Link your wallet before enabling background push");
      return;
    }
    try {
      const result =
        window.Notification.permission === "granted"
          ? "granted"
          : await window.Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("This browser does not support background push");
      }
      const configResponse = await fetch("/api/notifications/push-config", {
        cache: "no-store",
      });
      const configBody = (await configResponse.json()) as {
        publicKey?: string;
        error?: string;
      };
      if (!configResponse.ok || !configBody.publicKey) {
        throw new Error(configBody.error ?? "Web Push is not configured");
      }
      const registration =
        (await navigator.serviceWorker.getRegistration("/")) ??
        (await navigator.serviceWorker.register("/sw.js"));
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(configBody.publicKey),
        }));
      const response = await fetch("/api/notifications/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(subscription.toJSON()),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save push subscription");
      setPushSubscribed(true);
      setDraft((current) => ({
        ...current,
        channels: { ...current.channels, browser: true },
      }));
      setSaveMessage("Background push is ready for this browser");
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Unable to enable background push",
      );
    }
  };

  const sendBrowserTest = async () => {
    if (!linkedAddress || !pushSubscribed) {
      setSaveMessage("Link your wallet and enable background push before testing");
      return;
    }
    try {
      const response = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ channel: "browser" }),
      });
      const body = (await response.json()) as { error?: string };
      setSaveMessage(
        response.ok
          ? "Test push sent to this browser"
          : `Test push failed: ${body.error ?? "delivery error"}`,
      );
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? `Test push failed: ${error.message}` : "Test push failed",
      );
    }
  };

  const disconnectNotificationWallet = async () => {
    try {
      const response = await fetch("/api/notifications/wallet-session", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Unable to disconnect wallet");
      setLinkedAddress(null);
      setPushSubscribed(false);
      setDraft(defaultNotificationPreferences);
      setSaved(defaultNotificationPreferences);
      setDeliveredFeed([]);
      setExternalSecretsConfigured({ webhook: false, telegram: false, discord: false });
      setSaveMessage("Notification wallet disconnected");
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Unable to disconnect notification wallet",
      );
    }
  };

  const runSimulation = async (category: NotificationCategoryDefinition) => {
    const entry = buildSimulationEntry(draft, category, permission);
    setSimulationFeed((current) => [entry, ...current].slice(0, 6));

    if (
      entry.channels.includes("browser") &&
      typeof window !== "undefined" &&
      "Notification" in window
    ) {
      new window.Notification(category.label, {
        body: entry.title,
      });
    }
  };

  const totalCriticalCategories = notificationCategories.filter(
    (category) => category.priority === "Critical",
  ).length;
  const enabledCriticalCategories = notificationCategories.filter(
    (category) => category.priority === "Critical" && draft.categories[category.id],
  ).length;

  return (
    <div className="space-y-8">
      <section
        aria-labelledby="notification-wallet-heading"
        className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/70 p-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h2
            id="notification-wallet-heading"
            className="text-lg font-semibold text-white"
          >
            Notification wallet
          </h2>
          <p className="mt-1 text-sm text-slate-300" role="status" aria-live="polite">
            {linkedAddress
              ? `Verified wallet: ${linkedAddress}`
              : "Sign a one-time message with Freighter to access and save wallet-specific settings."}
          </p>
        </div>
        {linkedAddress ? (
          <button
            type="button"
            onClick={disconnectNotificationWallet}
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Disconnect wallet
          </button>
        ) : (
          <button
            type="button"
            onClick={connectNotificationWallet}
            className="rounded-full bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-200"
          >
            {wallet.session ? "Link wallet" : "Connect wallet"}
          </button>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.85fr]">
        <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(16,185,129,0.2),rgba(15,23,42,0.88)_48%,rgba(59,130,246,0.18))] p-6 shadow-[0_25px_80px_rgba(15,23,42,0.45)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="text-sm uppercase tracking-[0.3em] text-emerald-200/80">
                Notification Preference Center
              </p>
              <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                One place to tune noisy alerts into a dependable operating signal.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-200/80 sm:text-base">
                Control browser push, the in-app activity feed, and email delivery
                without losing sight of which task events still break through.
              </p>
            </div>

            <div className="grid min-w-[260px] gap-3 rounded-3xl border border-white/10 bg-slate-950/45 p-4 text-sm text-slate-200">
              <div className="flex items-center justify-between">
                <span>Enabled channels</span>
                <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white">
                  {enabledChannelCount}/{Object.keys(channelCopy).length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Enabled categories</span>
                <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white">
                  {enabledCategoryCount}/{notificationCategories.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Critical coverage</span>
                <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white">
                  {enabledCriticalCategories}/{totalCriticalCategories}
                </span>
              </div>
            </div>
          </div>
        </div>

        <aside
          className={`rounded-[28px] border p-6 shadow-[0_25px_80px_rgba(15,23,42,0.3)] ${permissionTone[permission].className}`}
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-current/70">
                Browser Permission
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                {permissionTone[permission].label}
              </h2>
            </div>
            <p className="text-sm leading-6 text-current/85">
              {permissionTone[permission].detail}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={requestPermission}
                disabled={
                  !linkedAddress ||
                  pushSubscribed ||
                  permission === "unsupported"
                }
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-white/70"
              >
                {pushSubscribed
                  ? "Background push enabled"
                  : permission === "denied"
                    ? "Enable notifications in browser settings"
                    : permission === "granted"
                      ? "Enable background push"
                      : "Enable background push"}
              </button>
              {pushSubscribed ? (
                <button
                  type="button"
                  onClick={sendBrowserTest}
                  className="rounded-full border border-current/25 px-4 py-2 text-sm font-medium text-current transition hover:bg-white/10"
                >
                  Send push test
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setPermission(getBrowserPermissionState())}
                className="rounded-full border border-current/25 px-4 py-2 text-sm font-medium text-current transition hover:bg-white/10"
              >
                Refresh status
              </button>
            </div>
          </div>
        </aside>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.35)]">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.24em] text-teal-200/70">
                  Channels
                </p>
                <h2 className="text-2xl font-semibold text-white">
                  Decide where alerts should arrive
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-300">
                  Channels are global. Category toggles below decide which events
                  are worth sending through those paths.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    dirty
                      ? "bg-amber-500/15 text-amber-200"
                      : "bg-emerald-500/15 text-emerald-200"
                  }`}
                >
                  {dirty ? "Unsaved changes" : formatRelativeTimestamp(saved.updatedAt)}
                </span>
                <button
                  type="button"
                  onClick={savePreferences}
                  disabled={!linkedAddress || !dirty || isSaving}
                  className="rounded-full bg-teal-300 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {isSaving ? "Saving..." : "Save preferences"}
                </button>
              </div>
            </div>

            <p className="mt-8 text-xs uppercase tracking-[0.24em] text-teal-200/70">
              Multi-channel endpoints (webhook / Telegram / Discord)
            </p>
            <label className="mt-3 block max-w-lg space-y-2 text-sm text-slate-200">
              <span>Email address for transactional notifications</span>
              <input
                aria-label="Notification email address"
                type="email"
                autoComplete="email"
                value={draft.emailAddress}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    emailAddress: event.target.value,
                  }));
                  setSaveMessage("Unsaved changes ready");
                }}
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-teal-300/50 focus:outline-none"
              />
            </label>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              {(["webhook", "telegram", "discord"] as ExternalChannelId[]).map((channel) => {
                const ping = pingResults[channel];
                return (
                  <div
                    key={`endpoint-${channel}`}
                    className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <div className="space-y-3">
                      <span className="text-sm font-semibold text-white">
                        {channelCopy[channel].label}
                      </span>
                      <input
                        aria-label={`${channelCopy[channel].label} endpoint URL`}
                        type="url"
                        placeholder={
                          channel === "telegram"
                            ? "Not required for Telegram"
                            : "https://hooks.example.com/…"
                        }
                        value={externalEndpointDrafts[channel].url}
                        onChange={(event) => {
                          const value = event.target.value;
                          setExternalEndpointDrafts((current) => ({
                            ...current,
                            [channel]: { ...current[channel], url: value },
                          }));
                          setDraft((current) => ({
                            ...current,
                            channels: { ...current.channels, [channel]: true },
                          }));
                          setSaveMessage("Unsaved changes ready");
                        }}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-teal-300/50 focus:outline-none"
                      />
                      {channel !== "discord" ? (
                        <input
                          aria-label={`${channelCopy[channel].label} secret`}
                          type="password"
                          autoComplete="new-password"
                          placeholder={
                            externalSecretsConfigured[channel]
                              ? "Secret stored securely — enter to replace"
                              : channel === "telegram"
                                ? "Chat ID:Bot token"
                                : "Webhook signing secret"
                          }
                          value={externalEndpointDrafts[channel].secret}
                          onChange={(event) => {
                            const value = event.target.value;
                            setExternalEndpointDrafts((current) => ({
                              ...current,
                              [channel]: { ...current[channel], secret: value },
                            }));
                            if (value) {
                              setDraft((current) => ({
                                ...current,
                                channels: { ...current.channels, [channel]: true },
                              }));
                              setSaveMessage("Unsaved changes ready");
                            }
                          }}
                          className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-teal-300/50 focus:outline-none"
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => runTestPing(channel)}
                        disabled={!linkedAddress}
                        className="w-full rounded-full border border-teal-300/30 px-4 py-2 text-sm font-medium text-teal-100 transition hover:bg-teal-300/10"
                      >
                        Send test ping
                      </button>
                      {ping ? (
                        <span
                          className={`block text-xs ${
                            ping.ok ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {ping.detail}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {(Object.keys(channelCopy) as NotificationChannel[]).map((channel) => {
                const blocked =
                  channel === "browser" && permission !== "granted";

                return (
                  <label
                    key={channel}
                    className="group rounded-3xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-teal-300/30 hover:bg-white/[0.05]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-semibold text-white">
                            {channelCopy[channel].label}
                          </span>
                          {blocked ? (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                              Blocked by browser
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm leading-6 text-slate-300">
                          {channelCopy[channel].description}
                        </p>
                      </div>

                      <input
                        aria-label={channelCopy[channel].label}
                        type="checkbox"
                        checked={draft.channels[channel]}
                        onChange={(event) => {
                          setDraft((current) => ({
                            ...current,
                            channels: {
                              ...current.channels,
                              [channel]: event.target.checked,
                            },
                          }));
                          setSaveMessage("Unsaved changes ready");
                        }}
                        className="mt-1 h-5 w-5 rounded border-white/20 bg-slate-900 text-teal-300 focus:ring-teal-300"
                      />
                    </div>
                  </label>
                );
              })}
            </div>
            <p className="mt-4 text-sm text-slate-400">{saveMessage}</p>
          </div>

          <div className="space-y-4">
            {Object.entries(groupedCategories).map(([group, categories]) => (
              <section
                key={group}
                className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.3)]"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-teal-200/70">
                      {group}
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">
                      {group === "Task Health"
                        ? "High-signal automation health"
                        : group === "Execution Activity"
                          ? "Operational run visibility"
                          : "Scheduled recap"}
                    </h3>
                  </div>
                  <p className="max-w-md text-sm leading-6 text-slate-300">
                    {group === "Task Health"
                      ? "Keep urgent failures and depleted balances loud enough to act on quickly."
                      : group === "Execution Activity"
                        ? "Reduce routine success noise while keeping skips visible."
                        : "Bundle lower-priority information into a calmer summary rhythm."}
                  </p>
                </div>

                <div className="mt-5 space-y-4">
                  {categories.map((category) => {
                    const activeChannels = getActiveDeliveryChannels(
                      draft,
                      category.id,
                      permission,
                    );

                    return (
                      <div
                        key={category.id}
                        className="rounded-3xl border border-white/8 bg-white/[0.025] p-4"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <label className="flex gap-4">
                            <input
                              aria-label={category.label}
                              type="checkbox"
                              checked={draft.categories[category.id]}
                              onChange={(event) => {
                                setDraft((current) => ({
                                  ...current,
                                  categories: {
                                    ...current.categories,
                                    [category.id]: event.target.checked,
                                  },
                                }));
                                setSaveMessage("Unsaved changes ready");
                              }}
                              className="mt-1 h-5 w-5 rounded border-white/20 bg-slate-900 text-teal-300 focus:ring-teal-300"
                            />
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-lg font-semibold text-white">
                                  {category.label}
                                </h4>
                                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300">
                                  {category.priority}
                                </span>
                              </div>
                              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                                {category.description}
                              </p>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                Recommended:{" "}
                                {category.recommendedChannels
                                  .map((channel) => channelCopy[channel].label)
                                  .join(" + ")}
                              </p>
                            </div>
                          </label>

                          <div className="space-y-3 lg:min-w-[260px]">
                            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                Live routing
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {(Object.keys(channelCopy) as NotificationChannel[]).map(
                                  (channel) => {
                                    const override =
                                      draft.categoryChannels[category.id];
                                    const selected = override
                                      ? override.includes(channel)
                                      : false;
                                    return (
                                      <button
                                        key={`route-${category.id}-${channel}`}
                                        type="button"
                                        aria-pressed={selected}
                                        aria-label={`Route ${category.label} via ${channelCopy[channel].label}`}
                                        onClick={() =>
                                          toggleCategoryChannel(category.id, channel)
                                        }
                                        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                                          selected
                                            ? "bg-teal-300 text-slate-950"
                                            : "bg-white/8 text-slate-300 hover:bg-white/12"
                                        }`}
                                      >
                                        {channelCopy[channel].label}
                                      </button>
                                    );
                                  },
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {activeChannels.length > 0 ? (
                                  activeChannels.map((channel) => (
                                    <span
                                      key={channel}
                                      className="rounded-full bg-teal-300/15 px-3 py-1 text-xs font-medium text-teal-100"
                                    >
                                      {channelCopy[channel].label}
                                    </span>
                                  ))
                                ) : (
                                  <span className="rounded-full bg-rose-500/15 px-3 py-1 text-xs font-medium text-rose-100">
                                    No delivery path active
                                  </span>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => runSimulation(category)}
                              className="w-full rounded-full border border-teal-300/30 px-4 py-2 text-sm font-medium text-teal-100 transition hover:bg-teal-300/10"
                            >
                              Simulate this notification
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <section
            aria-labelledby="notification-feed-heading"
            className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.35)]"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-teal-200/70">
                  Delivered
                </p>
                <h2 id="notification-feed-heading" className="mt-2 text-xl font-semibold text-white">
                  Recent notifications
                </h2>
              </div>
              <button
                type="button"
                disabled={!linkedAddress}
                onClick={() => {
                  void loadDeliveredFeed().catch((error: unknown) =>
                    setSaveMessage(
                      error instanceof Error ? error.message : "Unable to refresh notifications",
                    ),
                  );
                }}
                className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
            {!linkedAddress ? (
              <p className="mt-4 text-sm text-slate-400">
                Link your wallet to view its notification history.
              </p>
            ) : deliveredFeed.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400" role="status">
                No notifications have been delivered yet.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {deliveredFeed.map((notification) => (
                  <li
                    key={notification.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    <p className="font-medium text-white">{notification.title}</p>
                    <p className="mt-1 text-sm leading-5 text-slate-300">
                      {notification.message}
                    </p>
                    <time
                      className="mt-2 block text-xs text-slate-500"
                      dateTime={notification.timestamp}
                    >
                      {new Date(notification.timestamp).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.35)]">
            <p className="text-xs uppercase tracking-[0.24em] text-teal-200/70">
              Behavior Preview
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              See what would happen right now
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Every simulated event respects the current draft settings, so teams
              can verify signal paths before saving.
            </p>

            <div className="mt-5 space-y-3">
              {simulationFeed.length > 0 ? (
                simulationFeed.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">
                        {
                          notificationCategories.find(
                            (category) => category.id === entry.categoryId,
                          )?.label
                        }
                      </p>
                      <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                        {new Date(entry.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      {entry.title}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {entry.channels.map((channel) => (
                        <span
                          key={channel}
                          className="rounded-full bg-teal-300/15 px-3 py-1 text-xs font-medium text-teal-100"
                        >
                          Delivered to {channelCopy[channel].label}
                        </span>
                      ))}
                      {entry.channels.length === 0 ? (
                        <span className="rounded-full bg-rose-500/15 px-3 py-1 text-xs font-medium text-rose-100">
                          Event suppressed by your current settings
                        </span>
                      ) : null}
                      {entry.blockedChannels.map((channel) => (
                        <span
                          key={channel}
                          className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-100"
                        >
                          {channelCopy[channel].label} blocked by browser permission
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-sm leading-6 text-slate-400">
                  Run a simulation on any category to preview the actual delivery
                  channels and confirm whether browser permission will allow it.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.3)]">
            <p className="text-xs uppercase tracking-[0.24em] text-teal-200/70">
              Recovery Tips
            </p>
            <div className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
              <p>
                If browser push stays blocked, leave critical task alerts enabled
                in the in-app feed so operators still see a durable activity trail.
              </p>
              <p>
                Use email for slower summaries and escalation-friendly events such
                as low gas balance or paused tasks.
              </p>
              <p>
                Save after changes to keep the same routing behavior on your next
                visit to SoroTask.
              </p>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
