import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isEnabled = Boolean(SENTRY_DSN);

export function setSentryUser(user: { id: string; walletAddress?: string; role?: string }) {
  if (!isEnabled) return;
  Sentry.setUser({
    id: user.id,
    ...(user.walletAddress && {
      wallet_address: user.walletAddress.slice(0, 10) + "...",
    }),
    ...(user.role && { role: user.role }),
  });
}

export function clearSentryUser() {
  if (!isEnabled) return;
  Sentry.setUser(null);
}

export function addSentryBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: "info" | "warning" | "error" | "fatal" = "info"
) {
  if (!isEnabled) return;
  Sentry.addBreadcrumb({
    category,
    message,
    level,
    data,
    timestamp: Date.now() / 1000,
  });
}

export function captureSentryMessage(
  message: string,
  context?: Record<string, unknown>,
  level: "info" | "warning" | "error" | "fatal" = "info"
) {
  if (!isEnabled) return;
  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

export function captureSentryException(
  error: Error,
  context?: Record<string, unknown>
) {
  if (!isEnabled) return;
  Sentry.captureException(error, {
    extra: context,
  });
}

export function setSentryContext(key: string, context: Record<string, unknown>) {
  if (!isEnabled) return;
  Sentry.setContext(key, context);
}

export { isEnabled };
export default Sentry;
