"use client";

/**
 * WalletConnectionModal.tsx
 *
 * Unified multi-wallet connection hub. Supports Freighter, xBull, Albedo,
 * LOBSTR and Ledger hardware wallets, with per-wallet availability, loading
 * and error feedback. Built on the accessible Dialog primitive (focus trap,
 * Escape dismissal, role="dialog", aria-modal and labelled title).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/app/context/WalletContext";
import {
  WALLET_PROVIDERS_META,
  checkWalletAvailability,
  truncateAddress,
  type SupportedWallet,
} from "@/app/lib/wallet";
import { Modal, ModalFooter } from "@/components/Modal";

type AvailabilityMap = Partial<Record<SupportedWallet, boolean | null>>;

const WALLET_ICONS: Record<SupportedWallet, string> = {
  freighter: "🦊",
  xbull: "🐂",
  albedo: "🔵",
  lobstr: "🦞",
  ledger: "🔐",
};

const WALLET_ACCENT: Record<SupportedWallet, string> = {
  freighter: "bg-violet-600/20 ring-violet-500/30",
  xbull: "bg-amber-600/20 ring-amber-500/30",
  albedo: "bg-sky-600/20 ring-sky-500/30",
  lobstr: "bg-rose-600/20 ring-rose-500/30",
  ledger: "bg-emerald-600/20 ring-emerald-500/30",
};

export interface WalletConnectionModalProps {
  open: boolean;
  onClose: () => void;
}

function Spinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

function WalletLogo({ id }: { id: SupportedWallet }) {
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl ring-1 ${WALLET_ACCENT[id]}`}
      aria-hidden="true"
    >
      {WALLET_ICONS[id]}
    </div>
  );
}

function secondaryButtonClassName() {
  return "px-4 py-2 text-sm font-medium text-neutral-300 bg-neutral-800 rounded-lg hover:bg-neutral-700 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed";
}

function primaryButtonClassName() {
  return "px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed";
}

export function WalletConnectionModal({
  open,
  onClose,
}: WalletConnectionModalProps) {
  const {
    status,
    session,
    activeWallet,
    derivationPath,
    devicePrompt,
    errorCode,
    errorMessage,
    isLoading,
    connectWith,
    disconnect,
    clearError,
  } = useWallet();

  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const [pendingWallet, setPendingWallet] = useState<SupportedWallet | null>(
    null,
  );
  const [lastAttempt, setLastAttempt] = useState<SupportedWallet | null>(null);
  const wasConnectedRef = useRef(false);

  // Detect which wallets are present whenever the modal opens.
  useEffect(() => {
    if (!open) {
      setAvailability({});
      setPendingWallet(null);
      setLastAttempt(null);
      wasConnectedRef.current = false;
      return;
    }

    let cancelled = false;
    const next: AvailabilityMap = {};
    WALLET_PROVIDERS_META.forEach((meta) => {
      next[meta.id] = null;
    });
    setAvailability(next);

    Promise.all(
      WALLET_PROVIDERS_META.map(async (meta) => {
        try {
          return [meta.id, await checkWalletAvailability(meta.id)] as const;
        } catch {
          return [meta.id, false] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setAvailability(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const isConnecting = status === "connecting" || pendingWallet !== null;
  const isConnected = status === "connected" && session !== null;
  const isError = status === "error";

  const activeMeta = useMemo(
    () => WALLET_PROVIDERS_META.find((meta) => meta.id === activeWallet),
    [activeWallet],
  );

  // Close shortly after a successful connection so the user sees confirmation.
  useEffect(() => {
    if (!open) {
      wasConnectedRef.current = false;
      return;
    }
    if (isConnected && !wasConnectedRef.current) {
      wasConnectedRef.current = true;
      const timer = setTimeout(onClose, 700);
      return () => clearTimeout(timer);
    }
    if (!isConnected) {
      wasConnectedRef.current = false;
    }
  }, [open, isConnected, onClose]);

  const handleSelect = useCallback(
    async (walletId: SupportedWallet) => {
      setLastAttempt(walletId);
      setPendingWallet(walletId);
      try {
        await connectWith(walletId);
      } finally {
        setPendingWallet(null);
      }
    },
    [connectWith],
  );

  const handleRetry = useCallback(() => {
    const walletId = lastAttempt ?? activeWallet ?? "freighter";
    void handleSelect(walletId);
  }, [activeWallet, handleSelect, lastAttempt]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    onClose();
  }, [disconnect, onClose]);

  const modalTitle = isConnected
    ? "Wallet connected"
    : "Connect a Stellar wallet";
  const modalDescription = isConnected
    ? "Your wallet is ready to sign transactions."
    : "Choose a browser wallet or connect a Ledger hardware device.";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={modalTitle}
      description={modalDescription}
      size="md"
      isLoading={isConnecting}
    >
      <div className="space-y-5" data-testid="wallet-modal">
        {/* Connected */}
        {isConnected && session && (
          <div
            role="status"
            aria-live="polite"
            className="space-y-4"
            data-testid="wallet-state-connected"
          >
            <div className="flex items-center gap-4 rounded-xl border border-green-500/30 bg-green-500/10 p-4">
              <span
                className="h-3 w-3 shrink-0 rounded-full bg-green-400 shadow-sm shadow-green-400/50"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-400">
                  Connected via {activeMeta?.name ?? activeWallet ?? "wallet"}
                </p>
                <p className="mt-0.5 truncate font-mono text-sm text-neutral-100">
                  {session.address}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  Network:{" "}
                  <span className="font-medium text-neutral-300">
                    {session.network.network}
                  </span>
                </p>
                {derivationPath && (
                  <p className="mt-1 font-mono text-[11px] text-neutral-500">
                    Path: {derivationPath}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Hardware prompt */}
        {!isConnected && devicePrompt && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"
            data-testid="wallet-device-prompt"
          >
            <Spinner className="h-5 w-5 shrink-0 text-amber-300" />
            <span>{devicePrompt}</span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div
            role="alert"
            className="space-y-3"
            data-testid="wallet-state-error"
          >
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm font-medium text-red-300">
                {errorCode === "USER_REJECTED"
                  ? "Connection cancelled"
                  : errorCode === "WRONG_NETWORK"
                    ? "Wrong network"
                    : errorCode === "HARDWARE_ERROR"
                      ? "Hardware wallet error"
                      : errorCode === "NOT_INSTALLED"
                        ? "Wallet not installed"
                        : "Unable to connect"}
              </p>
              <p className="mt-2 text-sm text-red-200/90">{errorMessage}</p>
              {errorCode === "WRONG_NETWORK" && (
                <p className="mt-2 text-xs text-red-200/70">
                  Switch to Futurenet in your wallet, then try again.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Wallet list — kept visible after an error so switching is seamless */}
        {!isConnected && (
          <div
            className="space-y-2"
            aria-label="Supported wallets"
            data-testid="wallet-state-disconnected"
          >
            {WALLET_PROVIDERS_META.map((wallet) => {
              const isAvailable = availability[wallet.id];
              const isPending = pendingWallet === wallet.id;
              const unavailable = isAvailable === false;
              const checking =
                isAvailable === null || isAvailable === undefined;

              return (
                <button
                  key={wallet.id}
                  type="button"
                  onClick={() => void handleSelect(wallet.id)}
                  disabled={isConnecting || unavailable}
                  aria-label={`Connect with ${wallet.name}`}
                  aria-busy={isPending}
                  className={`flex w-full items-center gap-4 rounded-xl border p-3 text-left transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                    isPending
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-neutral-700 bg-neutral-800/40 hover:border-neutral-600"
                  }`}
                  data-testid={`wallet-option-${wallet.id}`}
                >
                  <WalletLogo id={wallet.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-neutral-200">
                      {wallet.name}
                    </span>
                    <span className="block text-xs text-neutral-400">
                      {wallet.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-neutral-400">
                    {isPending ? (
                      <span className="flex items-center gap-2">
                        <Spinner className="h-4 w-4 text-blue-400" />
                        Connecting…
                      </span>
                    ) : checking ? (
                      "Checking…"
                    ) : unavailable ? (
                      "Not detected"
                    ) : (
                      "Connect"
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ModalFooter>
        {isConnecting && (
          <button
            type="button"
            onClick={onClose}
            className={secondaryButtonClassName()}
          >
            Cancel
          </button>
        )}

        {isConnected && (
          <>
            <button
              type="button"
              onClick={handleDisconnect}
              className="px-4 py-2 text-sm font-medium text-red-400 bg-neutral-800 rounded-lg hover:bg-neutral-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Disconnect
            </button>
            <button
              type="button"
              onClick={onClose}
              className={primaryButtonClassName()}
            >
              Done
            </button>
          </>
        )}

        {isError && (
          <>
            <button
              type="button"
              onClick={() => {
                clearError();
                onClose();
              }}
              className={secondaryButtonClassName()}
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={handleRetry}
              disabled={isLoading || isConnecting}
              className={primaryButtonClassName()}
            >
              Try again
            </button>
          </>
        )}

        {!isConnected && !isError && !isConnecting && (
          <button
            type="button"
            onClick={onClose}
            className={secondaryButtonClassName()}
          >
            Cancel
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}

/** Compact connected-state label for header chips */
export function WalletConnectionSummary() {
  const { session, status } = useWallet();

  if (status !== "connected" || !session) return null;

  return (
    <span className="font-mono text-sm">
      {truncateAddress(session.address)}
    </span>
  );
}
