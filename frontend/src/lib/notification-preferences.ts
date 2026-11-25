export const NOTIFICATION_PREFERENCES_STORAGE_KEY =
  "sorotask.notification-preferences";

export type NotificationChannel = "inApp" | "browser" | "email" | "webhook" | "telegram" | "discord";

/** Channels that deliver to services the user configures (issue #1263). */
export type ExternalNotificationChannel = Exclude<
  NotificationChannel,
  "inApp" | "browser" | "email"
>;

export type NotificationCategoryId =
  | "taskFailed"
  | "taskRecovered"
  | "gasLow"
  | "taskPaused"
  | "executionSuccess"
  | "executionSkipped"
  | "weeklyDigest";

export type BrowserPermissionState =
  | NotificationPermission
  | "unsupported";

export type ExternalChannelEndpoint = {
  url: string;
  /** Optional secret, stored encrypted with the user's wallet public key
   *  (see notification-secrets.ts, issue #1263). */
  secret: string;
};

export type NotificationPreferences = {
  channels: Record<NotificationChannel, boolean>;
  categories: Record<NotificationCategoryId, boolean>;
  /** Per-category granular routing: when set, only the listed channels are
   *  used for that category; null/absent falls back to every enabled
   *  channel (issue #1263). */
  categoryChannels: Partial<Record<NotificationCategoryId, NotificationChannel[]>>;
  /** Delivery endpoints for the external channels. */
  externalEndpoints: Record<ExternalNotificationChannel, ExternalChannelEndpoint>;
  updatedAt: string | null;
};

export type NotificationCategoryDefinition = {
  id: NotificationCategoryId;
  label: string;
  description: string;
  group: "Task Health" | "Execution Activity" | "Digest";
  recommendedChannels: NotificationChannel[];
  priority: "Critical" | "Important" | "FYI";
};

export const notificationCategories: NotificationCategoryDefinition[] = [
  {
    id: "taskFailed",
    label: "Task failed",
    description: "Alert me when a task execution fails and needs attention.",
    group: "Task Health",
    recommendedChannels: ["inApp", "browser", "email"],
    priority: "Critical",
  },
  {
    id: "taskRecovered",
    label: "Task recovered",
    description: "Let me know when a failing task becomes healthy again.",
    group: "Task Health",
    recommendedChannels: ["inApp", "browser"],
    priority: "Important",
  },
  {
    id: "gasLow",
    label: "Low gas balance",
    description: "Warn me before a task runs out of execution gas.",
    group: "Task Health",
    recommendedChannels: ["inApp", "browser", "email"],
    priority: "Critical",
  },
  {
    id: "taskPaused",
    label: "Task paused",
    description: "Tell me when a task is paused because it can no longer run.",
    group: "Task Health",
    recommendedChannels: ["inApp", "browser", "email"],
    priority: "Critical",
  },
  {
    id: "executionSuccess",
    label: "Successful execution",
    description: "Surface routine successes in the feed without creating noise.",
    group: "Execution Activity",
    recommendedChannels: ["inApp"],
    priority: "FYI",
  },
  {
    id: "executionSkipped",
    label: "Execution skipped",
    description: "Notify me when a scheduled run is skipped or delayed.",
    group: "Execution Activity",
    recommendedChannels: ["inApp", "browser"],
    priority: "Important",
  },
  {
    id: "weeklyDigest",
    label: "Weekly digest",
    description: "Send a recap of task health, skipped runs, and gas trends.",
    group: "Digest",
    recommendedChannels: ["email"],
    priority: "FYI",
  },
];

export const externalNotificationChannels: ExternalNotificationChannel[] = [
  "webhook",
  "telegram",
  "discord",
];

const emptyExternalEndpoints = (): Record<ExternalNotificationChannel, ExternalChannelEndpoint> => ({
  webhook: { url: "", secret: "" },
  telegram: { url: "", secret: "" },
  discord: { url: "", secret: "" },
});

export const defaultNotificationPreferences: NotificationPreferences = {
  channels: {
    inApp: true,
    browser: true,
    email: false,
    webhook: false,
    telegram: false,
    discord: false,
  },
  categories: {
    taskFailed: true,
    taskRecovered: true,
    gasLow: true,
    taskPaused: true,
    executionSuccess: false,
    executionSkipped: true,
    weeklyDigest: false,
  },
  categoryChannels: {},
  externalEndpoints: emptyExternalEndpoints(),
  updatedAt: null,
};

export function loadNotificationPreferences(): NotificationPreferences {
  if (typeof window === "undefined") {
    return defaultNotificationPreferences;
  }

  try {
    const raw = window.localStorage.getItem(
      NOTIFICATION_PREFERENCES_STORAGE_KEY,
    );
    if (!raw) {
      return defaultNotificationPreferences;
    }

    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;

    return {
      channels: {
        ...defaultNotificationPreferences.channels,
        ...parsed.channels,
      },
      categories: {
        ...defaultNotificationPreferences.categories,
        ...parsed.categories,
      },
      categoryChannels: isPlainObject(parsed.categoryChannels)
        ? (parsed.categoryChannels as NotificationPreferences["categoryChannels"])
        : {},
      externalEndpoints: {
        ...emptyExternalEndpoints(),
        ...safeEndpoints(parsed.externalEndpoints),
      },
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return defaultNotificationPreferences;
  }
}

export function saveNotificationPreferences(
  preferences: NotificationPreferences,
): NotificationPreferences {
  const nextPreferences = {
    ...preferences,
    updatedAt: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      NOTIFICATION_PREFERENCES_STORAGE_KEY,
      JSON.stringify(nextPreferences),
    );
  }

  return nextPreferences;
}

export function getBrowserPermissionState(): BrowserPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  return window.Notification.permission;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeEndpoints(
  value: unknown,
): Partial<Record<ExternalNotificationChannel, ExternalChannelEndpoint>> {
  if (!isPlainObject(value)) return {};
  const out: Partial<Record<ExternalNotificationChannel, ExternalChannelEndpoint>> = {};
  for (const channel of externalNotificationChannels) {
    const entry = value[channel];
    if (isPlainObject(entry)) {
      out[channel] = {
        url: typeof entry.url === "string" ? entry.url : "",
        secret: typeof entry.secret === "string" ? entry.secret : "",
      };
    }
  }
  return out;
}

/** True when an external channel has enough configuration to deliver. */
export function isExternalChannelConfigured(
  channel: NotificationChannel,
  preferences: Pick<NotificationPreferences, "externalEndpoints">,
): boolean {
  if (channel === "inApp" || channel === "browser" || channel === "email") {
    return true;
  }
  const endpoint = preferences.externalEndpoints?.[channel];
  return Boolean(endpoint && endpoint.url.trim());
}

export function getActiveDeliveryChannels(
  preferences: NotificationPreferences,
  categoryId: NotificationCategoryId,
  permission: BrowserPermissionState,
): NotificationChannel[] {
  if (!preferences.categories[categoryId]) {
    return [];
  }

  // Granular routing (issue #1263): per-category overrides win over the
  // global channel switches.
  const override = preferences.categoryChannels?.[categoryId];
  const candidates = (override ?? Object.keys(preferences.channels)) as NotificationChannel[];

  return candidates.filter((channel) => {
    if (override && !preferences.channels[channel]) {
      // An override may only route through channels that are enabled
      // globally as well — the global switch is the master kill-switch.
      return false;
    }
    if (!preferences.channels[channel]) {
      return false;
    }

    if (channel === "browser") {
      return permission === "granted";
    }

    if (isExternalChannel(channel)) {
      return isExternalChannelConfigured(channel, preferences);
    }

    return true;
  });
}

function isExternalChannel(
  channel: NotificationChannel,
): channel is ExternalNotificationChannel {
  return channel === "webhook" || channel === "telegram" || channel === "discord";
}

export function getBlockedDeliveryChannels(
  preferences: NotificationPreferences,
  permission: BrowserPermissionState,
): NotificationChannel[] {
  if (preferences.channels.browser && permission !== "granted") {
    return ["browser"];
  }

  return [];
}
