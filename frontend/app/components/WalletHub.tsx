"use client";

/**
 * WalletHub.tsx
 *
 * Multi-wallet connection hub for Freighter, xBull, Albedo, LOBSTR and Ledger.
 * Mirrors the connection modal's provider list so the same five wallets are
 * available from any entry point.
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/app/context/WalletContext";
import {
  WALLET_PROVIDERS_META,
  checkWalletAvailability,
  truncateAddress,
  type SupportedWallet,
} from "@/app/lib/wallet";

const WALLET_ICONS: Record<SupportedWallet, string> = {
  freighter: "🦊",
  xbull: "🐂",
  albedo: "🔵",
  lobstr: "🦞",
  ledger: "🔐",
};

interface WalletHubProps {
  className?: string;
  compact?: boolean;
}

export function WalletHub({ className = "", compact = false }: WalletHubProps) {
  const {
    status,
    session,
    activeWallet,
    connectWith,
    openConnectModal,
    disconnect,
  } = useWallet();
  const [availableWallets, setAvailableWallets] = useState<
    Partial<Record<SupportedWallet, boolean>>
  >({});
  const [pendingWallet, setPendingWallet] = useState<SupportedWallet | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      WALLET_PROVIDERS_META.map(async (wallet) => {
        try {
          return [wallet.id, await checkWalletAvailability(wallet.id)] as const;
        } catch {
          return [wallet.id, false] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setAvailableWallets(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnect = useCallback(
    async (walletId: SupportedWallet) => {
      setPendingWallet(walletId);
      try {
        await connectWith(walletId);
      } finally {
        setPendingWallet(null);
      }
    },
    [connectWith],
  );

  const isConnected = status === "connected" && session !== null;
  const activeName =
    WALLET_PROVIDERS_META.find((wallet) => wallet.id === activeWallet)?.name ??
    activeWallet;

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {isConnected ? (
          <>
            <span className="text-sm text-neutral-300">
              {session?.address && truncateAddress(session.address)}
            </span>
            <button
              type="button"
              onClick={disconnect}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={openConnectModal}
            className="px-3 py-1 text-sm text-blue-400 hover:text-blue-300"
          >
            Connect Wallet
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {isConnected ? (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-green-400" />
            <div>
              <p className="text-sm font-medium text-neutral-200">
                Connected via {activeName ?? "wallet"}
              </p>
              <p className="font-mono text-sm text-neutral-300">
                {session?.address}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={disconnect}
            className="mt-3 px-4 py-2 text-sm font-medium text-red-400 bg-neutral-800 rounded-lg hover:bg-neutral-700 transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {WALLET_PROVIDERS_META.map((wallet) => {
            const isAvailable = availableWallets[wallet.id] !== false;
            const isPending = pendingWallet === wallet.id;

            return (
              <button
                key={wallet.id}
                type="button"
                onClick={() => void handleConnect(wallet.id)}
                disabled={!isAvailable || pendingWallet !== null}
                aria-label={`Connect with ${wallet.name}`}
                aria-busy={isPending}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-all ${
                  isAvailable
                    ? "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800/50 cursor-pointer"
                    : "border-neutral-800 bg-neutral-900/50 opacity-50 cursor-not-allowed"
                }`}
              >
                <span className="text-3xl" aria-hidden="true">
                  {WALLET_ICONS[wallet.id]}
                </span>
                <span className="text-sm font-medium text-neutral-200">
                  {wallet.name}
                </span>
                <span className="text-xs text-neutral-400 text-center">
                  {isPending ? "Connecting…" : wallet.description}
                </span>
                {!isAvailable && wallet.installUrl && (
                  <a
                    href={wallet.installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Install →
                  </a>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default WalletHub;
