"use client";

/**
 * WalletButton.tsx
 *
 * Header button that reflects the current wallet connection state.
 *
 * States:
 *  - Idle / restoring  → disabled spinner
 *  - Disconnected      → "Connect Wallet" button
 *  - Connecting        → "Connecting…" disabled button
 *  - Connected         → truncated address + network badge + Disconnect option
 *  - Error             → error message with retry + dismiss
 */

import { useWallet } from "@/app/context/WalletContext";
import { truncateAddress } from "@/app/lib/wallet";
import { useState } from "react";

export function WalletButton() {
  const { status, session, errorCode, errorMessage, isLoading, connect, disconnect, clearError } =
    useWallet();

  const [showDisconnect, setShowDisconnect] = useState(false);

  // -------------------------------------------------------------------------
  // Loading / restoring
  // -------------------------------------------------------------------------
  if (status === "idle" || status === "restoring") {
    return (
      <button
        disabled
        aria-busy="true"
        aria-label="Checking wallet status"
        className="flex items-center gap-2 bg-neutral-800 text-neutral-400 px-4 py-2 rounded-md font-medium cursor-not-allowed"
      >
        <span className="w-3 h-3 rounded-full border-2 border-neutral-500 border-t-transparent animate-spin" aria-hidden="true" />
        <span>Checking…</span>
      </button>
    );
  }

  // -------------------------------------------------------------------------
  // Connecting
  // -------------------------------------------------------------------------
  if (status === "connecting") {
    return (
      <button
        disabled
        aria-busy="true"
        aria-label="Connecting wallet"
        className="flex items-center gap-2 bg-blue-700 text-white px-4 py-2 rounded-md font-medium cursor-not-allowed opacity-80"
      >
        <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" aria-hidden="true" />
        <span>Connecting…</span>
      </button>
    );
  }

  // -------------------------------------------------------------------------
  // Error
  // -------------------------------------------------------------------------
  if (status === "error") {
    const isNotInstalled = errorCode === "NOT_INSTALLED";
    const isWrongNetwork = errorCode === "WRONG_NETWORK";

    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          {isNotInstalled ? (
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-amber-500 hover:bg-amber-400 text-neutral-900 px-4 py-2 rounded-md font-medium transition-colors text-sm"
            >
              Install Freighter
            </a>
          ) : (
            <button
              onClick={connect}
              className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-md font-medium transition-colors text-sm"
              aria-label="Retry wallet connection"
            >
              Retry
            </button>
          )}
          <button
            onClick={clearError}
            className="text-neutral-500 hover:text-neutral-300 text-sm px-2 py-2 transition-colors"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-red-400 max-w-[260px] text-right leading-snug">
          {isWrongNetwork
            ? "Wrong network — switch to Futurenet in Freighter."
            : errorMessage}
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Connected
  // -------------------------------------------------------------------------
  if (status === "connected" && session) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowDisconnect((v) => !v)}
          aria-expanded={showDisconnect}
          aria-haspopup="true"
          aria-label={`Wallet connected: ${session.address}`}
          className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-100 px-4 py-2 rounded-md font-medium transition-colors"
        >
          {/* Green connected dot */}
          <span
            className="w-2 h-2 rounded-full bg-green-400 shadow-sm shadow-green-400/50"
            aria-hidden="true"
          />
          <span className="font-mono text-sm">
            {truncateAddress(session.address)}
          </span>
          {/* Network badge */}
          <span className="text-xs bg-neutral-700 text-neutral-300 px-1.5 py-0.5 rounded">
            {session.network.network}
          </span>
          <span className="text-neutral-500 text-xs" aria-hidden="true">▾</span>
        </button>

        {/* Dropdown */}
        {showDisconnect && (
          <div
            role="menu"
            className="absolute right-0 mt-1 w-48 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl z-20 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-neutral-700">
              <p className="text-xs text-neutral-400">Connected address</p>
              <p className="text-xs font-mono text-neutral-200 break-all mt-0.5">
                {session.address}
              </p>
            </div>
            <button
              role="menuitem"
              onClick={() => {
                setShowDisconnect(false);
                disconnect();
              }}
              className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-neutral-700 transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Disconnected (default)
  // -------------------------------------------------------------------------
  return (
    <button
      onClick={connect}
      disabled={isLoading}
      className="bg-neutral-100 text-neutral-900 px-4 py-2 rounded-md font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Connect Wallet
    </button>
  );
}
