import * as Sentry from "@/src/lib/errors/sentry";

export function initializeErrorTracking(userData: {
  id: string;
  walletAddress?: string;
  role?: string;
}) {
  Sentry.setSentryUser({
    id: userData.id,
    walletAddress: userData.walletAddress,
    role: userData.role,
  });
  Sentry.addSentryBreadcrumb("auth", "User logged in", {
    userId: userData.id,
    role: userData.role,
  });
}

export function clearErrorTracking() {
  Sentry.clearSentryUser();
  Sentry.addSentryBreadcrumb("auth", "User logged out");
}

export function trackNavigation(to: string, from?: string) {
  Sentry.addSentryBreadcrumb("navigation", `Navigated to ${to}`, { to, from });
}

export function trackApiRequest(
  url: string,
  method: string = "GET",
  statusCode?: number
) {
  const level = statusCode && statusCode >= 400 ? "warning" : "info";
  Sentry.addSentryBreadcrumb(
    "http",
    `${method} ${url}${statusCode ? ` (${statusCode})` : ""}`,
    { url, method, statusCode },
    level
  );
}

export function trackApiError(
  url: string,
  method: string,
  error: Error,
  response?: Response
) {
  Sentry.addSentryBreadcrumb(
    "http",
    `API error: ${method} ${url}`,
    { url, method, errorMessage: error.message, statusCode: response?.status },
    "error"
  );
  Sentry.captureSentryException(error, {
    tags: { type: "api_error", endpoint: url, method },
    extra: { url, method, statusCode: response?.status, statusText: response?.statusText },
  });
}

export function trackWalletAction(action: string, details?: Record<string, unknown>) {
  Sentry.addSentryBreadcrumb("wallet", `Wallet action: ${action}`, details);
}

export function trackWalletError(error: Error, context?: Record<string, unknown>) {
  Sentry.addSentryBreadcrumb("wallet", `Wallet error: ${error.message}`, context, "error");
  Sentry.captureSentryException(error, {
    tags: { type: "wallet_error" },
    extra: context,
  });
}

export function trackUserAction(
  action: string,
  element: string,
  details?: Record<string, unknown>
) {
  Sentry.addSentryBreadcrumb("ui.action", `User clicked: ${action}`, {
    element,
    ...details,
  });
}

export function trackPerformance(metric: string, value: number, unit: string = "ms") {
  Sentry.addSentryBreadcrumb("performance", `Performance: ${metric}`, { value, unit });
}

export function trackSocketEvent(
  event: string,
  direction: "sent" | "received" | "subscribed",
  extraData?: Record<string, unknown>
) {
  Sentry.addSentryBreadcrumb("socket", `Socket ${direction}: ${event}`, {
    direction,
    event,
    ...extraData,
  });
}

export function trackSocketError(error: Error, context?: Record<string, unknown>) {
  Sentry.addSentryBreadcrumb("socket", `Socket error: ${error.message}`, context, "error");
  Sentry.captureSentryException(error, {
    tags: { type: "socket_error" },
    extra: context,
  });
}

export function setTaskContext(taskId: string | number, taskData?: Record<string, unknown>) {
  Sentry.setSentryContext("task", { taskId, ...taskData });
}

export function clearTaskContext() {
  Sentry.setSentryContext("task", {});
}

export function setGlobalContext(context: Record<string, unknown>) {
  Sentry.setSentryContext("session", context);
}

export class TrackedError extends Error {
  constructor(
    message: string,
    public code?: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TrackedError";
    Sentry.captureSentryException(this, {
      tags: { code: code || "unknown" },
      extra: context,
    });
  }
}

export async function trackAsync<T>(
  fn: () => Promise<T>,
  context?: { operation: string; taskId?: string | number; userId?: string }
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    if (duration > 1000) {
      trackPerformance(context?.operation || "async_operation", duration);
    }
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    Sentry.captureSentryException(err, {
      tags: {
        operation: context?.operation || "unknown",
        ...(context?.taskId && { taskId: String(context.taskId) }),
      },
      extra: { ...context, duration: Date.now() - startTime },
    });
    throw err;
  }
}

export function trackSync<T>(
  fn: () => T,
  context?: { operation: string; taskId?: string | number }
): T {
  const startTime = Date.now();
  try {
    return fn();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    Sentry.captureSentryException(err, {
      tags: {
        operation: context?.operation || "unknown",
        ...(context?.taskId && { taskId: String(context.taskId) }),
      },
      extra: { ...context, duration: Date.now() - startTime },
    });
    throw err;
  }
}


