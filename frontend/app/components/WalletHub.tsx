"use client";

/**
 * WalletHub.tsx
 *
 * Multi-wallet connection hub that allows users to select from
 * available Stellar wallets (Freighter, Albedo, xBull, LOBSTR).
 */

import { useEffect, useState } from "react";
import { useWallet } from "@/app/context/WalletContext";
import { truncateAddress } from "@/app/lib/wallet";

// Wallet provider definitions
const WALLET_PROVIDERS = [
  {
    id: "freighter" as const,
    name: "Freighter",
    description: "Browser extension for Stellar",
    icon: "🦊",
    color: "violet",
    installUrl: "https://www.freighter.app/",
  },
  {
    id: "albedo" as const,
    name: "Albedo",
    description: "Web-based Stellar wallet",
    icon: "🌟",
    color: "blue",
    installUrl: "https://albedo.link/",
  },
  {
    id: "xbull" as const,
    name: "xBull",
    description: "Stellar browser extension",
    icon: "🐂",
    color: "amber",
    installUrl: "https://xbull.app/",
  },
  {
    id: "lobstr" as const,
    name: "LOBSTR",
    description: "Mobile & web Stellar wallet",
    icon: "🦞",
    color: "red",
    installUrl: "https://lobstr.co/",
  },
] as const;

type WalletProviderId = (typeof WALLET_PROVIDERS)[number]["id"];

interface WalletHubProps {
  className?: string;
  compact?: boolean;
}

export function WalletHub({ className = "", compact = false }: WalletHubProps) {
  const { status, session, connect, disconnect } = useWallet();
  const [availableWallets, setAvailableWallets] = useState<Set<WalletProviderId>>(
    new Set()
  );
  const [selectedWallet, setSelectedWallet] = useState<WalletProviderId | null>(null);

  // Check wallet availability on mount
  useEffect(() => {
    const checkAvailability = async () => {
      const available = new Set<WalletProviderId>();
      
      for (const wallet of WALLET_PROVIDERS) {
        try {
          // Dynamic import for wallet-specific checks
          if (wallet.id === "freighter") {
            const { isConnected } = await import("@stellar/freighter-api");
            const result = await isConnected();
            if (result.isConnected) available.add("freighter");
          }
          // For other wallets, check window injections
          if (typeof window !== "undefined") {
            if (wallet.id === "albedo" && typeof (window as any).albedo !== "undefined") {
              available.add("albedo");
            }
            if (wallet.id === "xbull" && (typeof (window as any).xBull !== "undefined" || typeof (window as any).xBullSDK !== "undefined")) {
              available.add("xbull");
            }
            if (wallet.id === "lobstr" && (typeof (window as any).LobstrSigner !== "undefined" || typeof (window as any).lobstr !== "undefined")) {
              available.add("lobstr");
            }
          }
        } catch {
          // Wallet not available
        }
      }
      
      setAvailableWallets(available);
    };

    checkAvailability();
  }, []);

  const handleConnect = async (walletId: WalletProviderId) => {
    setSelectedWallet(walletId);
    // TODO: This would be extended to pass the wallet ID to the connect function
    // For now, we use the existing connect which defaults to Freighter
    await connect();
  };

  const isConnected = status === "connected" && session !== null;

  // Compact mode - just show status
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {isConnected ? (
          <>
            <span className="text-sm text-neutral-300">
              {session?.address && truncateAddress(session.address)}
            </span>
            <button
              onClick={disconnect}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            onClick={() => handleConnect("freighter")}
            className="px-3 py-1 text-sm text-blue-400 hover:text-blue-300"
          >
            Connect Wallet
          </button>
        )}
      </div>
    );
  }

  // Full hub mode - show wallet selection grid
  return (
    <div className={`space-y-4 ${className}`}>
      {isConnected ? (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-green-400" />
            <div>
              <p className="text-sm font-medium text-neutral-200">Connected</p>
              <p className="font-mono text-sm text-neutral-300">
                {session?.address}
              </p>
            </div>
          </div>
          <button
            onClick={disconnect}
            className="mt-3 px-4 py-2 text-sm font-medium text-red-400 bg-neutral-800 rounded-lg hover:bg-neutral-700 transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {WALLET_PROVIDERS.map((wallet) => {
            const isAvailable = availableWallets.has(wallet.id);

            return (
              <button
                key={wallet.id}
                onClick={() => handleConnect(wallet.id)}
                disabled={!isAvailable}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                  isAvailable
                    ? "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800/50 cursor-pointer"
                    : "border-neutral-800 bg-neutral-900/50 opacity-50 cursor-not-allowed"
                }`}
              >
                <span className="text-3xl">{wallet.icon}</span>
                <span className="text-sm font-medium text-neutral-200">
                  {wallet.name}
                </span>
                <span className="text-xs text-neutral-400 text-center">
                  {wallet.description}
                </span>
                {!isAvailable && (
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
