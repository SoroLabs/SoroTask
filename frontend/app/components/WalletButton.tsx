"use client";

/**
 * WalletButton.tsx
 *
 * Header trigger for the wallet connection modal. Shows a compact connection
 * state in the nav; full connect/error/disconnect flows live in the modal.
 */

import { useWallet, useWalletOptional } from "@/app/context/WalletContext";
import { truncateAddress } from "@/app/lib/wallet";

export function WalletButton() {
  const wallet = useWalletOptional();
  const { status, session, errorCode, isLoading, openConnectModal, connect } = wallet;

  if (status === "idle" || status === "restoring") {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        aria-label="Checking wallet status"
        data-testid="connect-wallet-button"
        className="flex items-center gap-2 rounded-md bg-neutral-800 px-4 py-2 font-medium text-neutral-400 cursor-not-allowed"
      >
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"
          aria-hidden="true"
        />
        <span>Checking…</span>
      </button>
    );
  }

  if (status === "connecting") {
    return (
      <button
        type="button"
        onClick={openConnectModal}
        aria-busy="true"
        aria-label="Connecting wallet — open connection modal"
        data-testid="connect-wallet-button"
        className="flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 font-medium text-white opacity-80 transition-colors hover:bg-blue-600"
      >
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"
          aria-hidden="true"
        />
        <span>Connecting…</span>
      </button>
    );
  }

  if (status === "connected" && session) {
    return (
      <button
        type="button"
        onClick={openConnectModal}
        aria-label={`Wallet connected: ${session.address}. Open wallet modal.`}
        data-testid="wallet-connected-button"
        id="connect-wallet-btn"
        className="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-800 px-4 py-2 font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
      >
        <span
          className="h-2 w-2 rounded-full bg-green-400 shadow-sm shadow-green-400/50"
          aria-hidden="true"
        />
        <span className="font-mono text-sm">
          {truncateAddress(session.address)}
        </span>
        <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300">
          {session.network.network}
        </span>
      </button>
    );
  }

  if (status === "error") {
    const errorLabel =
      errorCode === "NOT_INSTALLED"
        ? "Freighter not installed"
        : errorCode === "WRONG_NETWORK"
          ? "Wrong network"
          : "Connection failed";

    return (
      <button
        type="button"
        onClick={openConnectModal}
        aria-label={`${errorLabel}. Open wallet modal to retry.`}
        data-testid="connect-wallet-button"
        id="connect-wallet-btn"
        className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20"
      >
        <span aria-hidden="true">⚠</span>
        <span>{errorLabel}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      id="connect-wallet-btn"
      data-testid="connect-wallet-button"
      onClick={() => {
        openConnectModal();
        void connect();
      }}
      disabled={isLoading}
      aria-label="Connect your Stellar wallet"
      className="rounded-md bg-neutral-100 px-4 py-2 font-medium text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Connect Wallet
    </button>
  );
}
