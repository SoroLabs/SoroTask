import { addSentryBreadcrumb } from "./sentry";

/** Breadcrumb categories used across wallet + transaction telemetry. */
export const BreadcrumbCategory = {
  Wallet: "wallet",
  Transaction: "transaction",
} as const;

export type WalletEvent =
  | "connect"
  | "disconnect"
  | "account_changed"
  | "sign_requested"
  | "sign_succeeded"
  | "sign_rejected";

export type TransactionPhase =
  | "requested"
  | "awaiting_signature"
  | "submitting"
  | "confirmed_on_ledger"
  | "failed";

/**
 * Records a wallet connection/account lifecycle breadcrumb.
 * No-op when Sentry is disabled (no NEXT_PUBLIC_SENTRY_DSN).
 */
export function captureWalletBreadcrumb(
  event: WalletEvent,
  data?: Record<string, unknown>
): void {
  addSentryBreadcrumb(BreadcrumbCategory.Wallet, `wallet.${event}`, data, "info");
}

/**
 * Records a multi-step transaction lifecycle breadcrumb (#810/#813), e.g.
 * awaiting signature -> submitting -> confirmed on ledger.
 */
export function captureTransactionBreadcrumb(
  phase: TransactionPhase,
  txHash?: string,
  data?: Record<string, unknown>
): void {
  addSentryBreadcrumb(
    BreadcrumbCategory.Transaction,
    `transaction.${phase}`,
    {
      ...(txHash ? { txHash } : {}),
      ...(data ?? {}),
    },
    phase === "failed" ? "error" : "info"
  );
}