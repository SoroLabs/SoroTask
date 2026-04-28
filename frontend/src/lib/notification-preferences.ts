export const NOTIFICATION_PREFERENCES_STORAGE_KEY =
  "sorotask.notification-preferences";

export type NotificationChannel = "inApp" | "browser" | "email";

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

export type NotificationPreferences = {
  channels: Record<NotificationChannel, boolean>;
  categories: Record<NotificationCategoryId, boolean>;
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

export const defaultNotificationPreferences: NotificationPreferences = {
  channels: {
    inApp: true,
    browser: true,
    email: false,
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

export function getActiveDeliveryChannels(
  preferences: NotificationPreferences,
  categoryId: NotificationCategoryId,
  permission: BrowserPermissionState,
): NotificationChannel[] {
  if (!preferences.categories[categoryId]) {
    return [];
  }

  return (Object.keys(preferences.channels) as NotificationChannel[]).filter(
    (channel) => {
      if (!preferences.channels[channel]) {
        return false;
      }

      if (channel === "browser") {
        return permission === "granted";
      }

      return true;
    },
  );
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
