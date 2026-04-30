"use client";

/**
 * WalletGate.tsx
 *
 * Wraps any blockchain-only UI section. When the wallet is not connected,
 * renders a clear prompt instead of the gated content.
 *
 * Usage:
 *   <WalletGate>
 *     <RegisterTaskForm />
 *   </WalletGate>
 *
 * Optional props:
 *   - message: custom prompt text
 *   - fallback: fully custom fallback node (overrides default prompt)
 */

import { useWallet } from "@/app/context/WalletContext";

type WalletGateProps = {
  children: React.ReactNode;
  /** Custom message shown when wallet is not connected */
  message?: string;
  /** Fully custom fallback — replaces the default prompt entirely */
  fallback?: React.ReactNode;
};

export function WalletGate({
  children,
  message = "Connect your Freighter wallet to continue.",
  fallback,
}: WalletGateProps) {
  const { status, connect, isLoading } = useWallet();

  const isConnected = status === "connected";

  if (isConnected) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-4 py-10 text-center"
    >
      {/* Lock icon */}
      <div className="w-12 h-12 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-2xl" aria-hidden="true">
        🔒
      </div>
      <p className="text-neutral-400 text-sm max-w-xs">{message}</p>
      <button
        onClick={connect}
        disabled={isLoading}
        className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-600/20"
      >
        {isLoading ? "Connecting…" : "Connect Wallet"}
      </button>
    </div>
  );
}
