"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  defaultNotificationPreferences,
  getActiveDeliveryChannels,
  getBlockedDeliveryChannels,
  getBrowserPermissionState,
  loadNotificationPreferences,
  notificationCategories,
  saveNotificationPreferences,
  type BrowserPermissionState,
  type NotificationCategoryDefinition,
  type NotificationCategoryId,
  type NotificationChannel,
  type NotificationPreferences,
} from "../lib/notification-preferences";

type SimulationEntry = {
  id: number;
  categoryId: NotificationCategoryId;
  title: string;
  channels: NotificationChannel[];
  blockedChannels: NotificationChannel[];
  createdAt: string;
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
      "Show desktop or tab notifications when the browser grants permission.",
  },
  email: {
    label: "Email summaries",
    description: "Deliver important alerts and digests outside the app.",
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

export function NotificationPreferenceCenter() {
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
  const [isSaving, startTransition] = useTransition();

  useEffect(() => {
    const initialPreferences = loadNotificationPreferences();
    setDraft(initialPreferences);
    setSaved(initialPreferences);
    setPermission(getBrowserPermissionState());
    setSaveMessage(
      initialPreferences.updatedAt ? "Preferences loaded" : "Using smart defaults",
    );
  }, []);

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
    JSON.stringify(draft.categories) !== JSON.stringify(saved.categories);

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

  const savePreferences = () => {
    startTransition(() => {
      try {
        const next = saveNotificationPreferences(draft);
        setDraft(next);
        setSaved(next);
        setSaveMessage("Preferences saved successfully");
      } catch {
        setSaveMessage("Saving failed. Please try again.");
      }
    });
  };

  const requestPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }

    const result = await window.Notification.requestPermission();
    setPermission(result);
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
                  {enabledChannelCount}/3
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
                disabled={permission === "granted" || permission === "unsupported"}
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-white/70"
              >
                {permission === "denied"
                  ? "Try again after enabling in browser settings"
                  : "Request browser permission"}
              </button>
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
                  disabled={!dirty || isSaving}
                  className="rounded-full bg-teal-300 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {isSaving ? "Saving..." : "Save preferences"}
                </button>
              </div>
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
