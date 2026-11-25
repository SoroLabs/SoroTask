/**
 * Wallet Error Tracking
 *
 * Specialized error tracking for wallet-related operations:
 * - Wallet connection errors
 * - Transaction signing errors
 * - Network mismatches
 * - Balance/insufficient funds errors
 */

import { trackWalletError, trackWalletAction } from "./tracking";
import { mapContractError } from "./contractErrors";

/**
 * Track wallet connection attempt
 */
export function trackWalletConnectionAttempt(network?: string) {
  trackWalletAction("connect_attempt", { network });
}

/**
 * Track successful wallet connection
 */
export function trackWalletConnected(walletAddress: string, network?: string) {
  trackWalletAction("connected", {
    walletAddress: maskAddress(walletAddress),
    network,
  });
}

/**
 * Track wallet disconnection
 */
export function trackWalletDisconnected() {
  trackWalletAction("disconnected");
}

/**
 * Track transaction signing attempt
 */
export function trackTransactionSigning(taskId: string | number) {
  trackWalletAction("signing_start", { taskId });
}

/**
 * Track successful transaction
 */
export function trackTransactionSuccess(txHash: string, taskId?: string | number) {
  trackWalletAction("transaction_success", {
    txHash: txHash.slice(0, 10) + "...",
    taskId,
  });
}

/**
 * Track failed transaction with error classification
 */
export function trackTransactionError(
  error: Error,
  taskId?: string | number,
  txHash?: string
) {
  const mappedError = mapContractError(error);

  trackWalletError(error, {
    taskId,
    txHash: txHash?.slice(0, 10) + "...",
    errorCategory: mappedError.category,
    errorTitle: mappedError.title,
  });
}

/**
 * Track network switch attempt
 */
export function trackNetworkSwitch(fromNetwork: string, toNetwork: string) {
  trackWalletAction("network_switch", { from: fromNetwork, to: toNetwork });
}

/**
 * Track wallet type detection (Freighter, etc.)
 */
export function trackWalletDetected(walletType: string, installed: boolean) {
  trackWalletAction("wallet_detected", {
    walletType,
    installed,
  });
}

/**
 * Handle wallet error with appropriate user messaging and tracking
 * Returns a user-friendly error message
 */
export function handleWalletError(
  error: Error,
  context?: Record<string, unknown>
): { userMessage: string; category: string; retryable: boolean } {
  const mappedError = mapContractError(error);

  // Track the error
  trackWalletError(error, context);

  return {
    userMessage: mappedError.userMessage,
    category: mappedError.category,
    retryable: mappedError.retryable,
  };
}

/**
 * Mask wallet address for privacy (show first 10 chars only)
 */
function maskAddress(address: string): string {
  if (address.length <= 10) return address;
  return address.slice(0, 10) + "...";
}

/**
 * Check if error is wallet-related
 */
export function isWalletError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const name = (error.name || "").toLowerCase();

  return (
    message.includes("wallet") ||
    message.includes("freight") ||
    name.includes("wallet") ||
    name.includes("freight") ||
    name.includes("stellar")
  );
}

/**
 * Check if error is network-specific (wrong network)
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();

  return (
    message.includes("network") &&
    (message.includes("mismatch") || message.includes("wrong") || message.includes("passphrase"))
  );
}
