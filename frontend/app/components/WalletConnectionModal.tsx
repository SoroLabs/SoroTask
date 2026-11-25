"use client";

/**
 * WalletConnectionModal.tsx
 *
 * Modal flow for connecting Stellar wallets. Supports Freighter, Albedo, xBull, and LOBSTR.
 */

import { useEffect, useState } from "react";
import { useWallet } from "@/app/context/WalletContext";
import { isFreighterInstalled, truncateAddress } from "@/app/lib/wallet";
import { Modal, ModalFooter } from "@/components/Modal";
import { FreighterWalletProvider, AlbedoWalletProvider, XBullWalletProvider, LobstrWalletProvider, MockWalletProvider } from "@/app/lib/wallet-providers";

const FREIGHTER_INSTALL_URL = "https://www.freighter.app/";

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

function WalletLogo({ name }: { name: string }) {
  const logos: Record<string, string> = {
    Freighter: "🦊",
    Albedo: "🔵",
    xBull: "🐂",
    LOBSTR: "🌟",
  };
  return (
    <div
      className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/20 text-2xl ring-1 ring-violet-500/30"
      aria-hidden="true"
    >
      {logos[name] || "💳"}
    </div>
  );
}

interface WalletOption {
  id: string;
  name: string;
  provider: { isAvailable(): Promise<boolean> };
  connect(): Promise<{ address: string; networkPassphrase: string; network: string; networkUrl: string; sorobanRpcUrl?: string }>;
}

const WALLET_OPTIONS: WalletOption[] = [
  { id: "freighter", name: "Freighter", provider: new FreighterWalletProvider(), connect: () => (new FreighterWalletProvider() as any).connect() },
  { id: "albedo", name: "Albedo", provider: new AlbedoWalletProvider(), connect: () => (new AlbedoWalletProvider() as any).connect() },
  { id: "xbull", name: "xBull", provider: new XBullWalletProvider(), connect: () => (new XBullWalletProvider() as any).connect() },
  { id: "lobstr", name: "LOBSTR", provider: new LobstrWalletProvider(), connect: () => (new LobstrWalletProvider() as any).connect() },
];

function secondaryButtonClassName() {
  return "px-4 py-2 text-sm font-medium text-neutral-300 bg-neutral-800 rounded-lg hover:bg-neutral-700 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed";
}

function primaryButtonClassName() {
  return "px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed";
}

export function WalletConnectionModal({ open, onClose }: WalletConnectionModalProps) {
  const {
    status,
    session,
    errorCode,
    errorMessage,
    isLoading,
    connect,
    disconnect,
    clearError,
  } = useWallet();

  const [freighterInstalled, setFreighterInstalled] = useState<boolean | null>(null);
  const [availableWallets, setAvailableWallets] = useState<Set<string>>(new Set());
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFreighterInstalled(null);
      setAvailableWallets(new Set());
      setSelectedWallet(null);
      return;
    }

    let cancelled = false;

    Promise.all([
      isFreighterInstalled(),
      new AlbedoWalletProvider().isAvailable(),
      new XBullWalletProvider().isAvailable(),
      new LobstrWalletProvider().isAvailable(),
    ]).then(([freighter, albedo, xbull, lobstr]) => {
      if (cancelled) return;
      const available = new Set<string>();
      if (freighter) available.add("freighter");
      if (albedo) available.add("albedo");
      if (xbull) available.add("xbull");
      if (lobstr) available.add("lobstr");
      setAvailableWallets(available);
      setFreighterInstalled(freighter);
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleWalletSelect = (walletId: string) => setSelectedWallet(walletId);

  const handleConnectWithWallet = async (wallet: WalletOption) => {
    try {
      await wallet.connect();
    } catch (err) {
      console.error(`Failed to connect ${wallet.name}:`, err);
    }
  };

  const isConnecting = status === "connecting";
  const isConnected = status === "connected" && session !== null;
  const isError = status === "error";

  useEffect(() => {
    if (open && isConnected) {
      const timer = setTimeout(() => {
        onClose();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [open, isConnected, onClose]);
  const showNotInstalled =
    freighterInstalled === false || (isError && errorCode === "NOT_INSTALLED");

  const handleConnect = () => {
    void connect();
  };

  const handleDismissError = () => {
    clearError();
  };

  const handleDisconnect = () => {
    disconnect();
    onClose();
  };

  const modalTitle = isConnected
    ? "Wallet connected"
    : isConnecting
      ? "Connecting wallet"
      : isError
        ? "Connection failed"
        : showNotInstalled
          ? "Install Freighter"
          : "Connect wallet";

  const modalDescription = isConnected
    ? "Your Freighter wallet is ready to sign transactions."
    : isConnecting
      ? "Approve the connection request in the Freighter extension."
      : showNotInstalled
        ? "Freighter is required to sign Stellar transactions in SoroTask."
        : "Connect your Freighter wallet to interact with Soroban contracts.";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={modalTitle}
      description={modalDescription}
      size="sm"
      isLoading={isConnecting}
    >
      <div className="space-y-5" data-testid="wallet-modal">
        {/* Connecting */}
        {isConnecting && (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-4 py-4 text-center"
            data-testid="wallet-state-connecting"
          >
            <Spinner className="h-10 w-10 text-blue-400" />
            <div>
              <p className="text-sm font-medium text-neutral-200">
                Waiting for Freighter…
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Check your browser toolbar for the Freighter popup.
              </p>
            </div>
          </div>
        )}

        {/* Connected */}
        {!isConnecting && isConnected && session && (
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
                <p className="text-xs text-neutral-400">Connected address</p>
                <p className="mt-0.5 truncate font-mono text-sm text-neutral-100">
                  {session.address}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  Network:{" "}
                  <span className="font-medium text-neutral-300">
                    {session.network.network}
                  </span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {!isConnecting && isError && !showNotInstalled && (
          <div
            role="alert"
            className="space-y-4"
            data-testid="wallet-state-error"
          >
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm font-medium text-red-300">
                {errorCode === "USER_REJECTED"
                  ? "Connection cancelled"
                  : errorCode === "WRONG_NETWORK"
                    ? "Wrong network"
                    : "Unable to connect"}
              </p>
              <div className="mt-2 text-sm text-red-200/90 space-y-3">
                {errorCode === "WRONG_NETWORK" ? (
                  <>
                    <p>Switch to <strong>Futurenet</strong> in Freighter, then try again.</p>
                    <div className="rounded border border-red-500/20 bg-red-950/30 p-3 mt-3 text-xs leading-relaxed space-y-2">
                      <p className="font-semibold text-red-200">Can't find Futurenet?</p>
                      <ol className="list-decimal pl-4 space-y-1">
                        <li>Open Freighter Settings (⚙️) ➝ Preferences</li>
                        <li>Turn on <strong>"Developer Mode"</strong> or <strong>"Show Test Networks"</strong></li>
                        <li>Go to <strong>Network</strong> ➝ <strong>Add Custom Network</strong></li>
                      </ol>
                      <ul className="pl-1 pt-1 space-y-1 text-red-200/80">
                        <li><span className="font-medium text-red-200">Name:</span> Futurenet</li>
                        <li><span className="font-medium text-red-200">RPC URL:</span> https://rpc-futurenet.stellar.org</li>
                        <li><span className="font-medium text-red-200">Horizon URL:</span> https://horizon-futurenet.stellar.org</li>
                        <li><span className="font-medium text-red-200">Passphrase:</span> Test SDF Future Network ; October 2022</li>
                        <li><span className="font-medium text-red-200">Friendbot URL:</span> https://friendbot-futurenet.stellar.org/</li>
                      </ul>
                    </div>
                  </>
                ) : (
                  <p>{errorMessage}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Freighter not installed — proactive or post-error */}
        {!isConnecting && !isConnected && showNotInstalled && (
          <div
            role="status"
            className="space-y-4"
            data-testid="wallet-state-not-installed"
          >
            <div className="flex items-start gap-4">
              <FreighterLogo />
              <div>
                <p className="text-sm font-medium text-neutral-200">
                  Freighter extension not detected
                </p>
                <p className="mt-1 text-sm text-neutral-400">
                  Install Freighter for Chrome, Firefox, or Brave to connect your
                  Stellar wallet. You can still browse SoroTask without a wallet.
                </p>
              </div>
            </div>
            <a
              href={FREIGHTER_INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-neutral-900 transition-colors hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              Install Freighter
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        )}

        {/* Disconnected — ready to connect */}
        {!isConnecting &&
          !isConnected &&
          !isError &&
          freighterInstalled !== false && (
            <div className="space-y-4" data-testid="wallet-state-disconnected">
              <div className="space-y-3">
                {WALLET_OPTIONS.map((wallet) => {
                  const isAvailable = availableWallets.has(wallet.id);
                  return (
                    <button
                      key={wallet.id}
                      type="button"
                      onClick={() => handleWalletSelect(wallet.id)}
                      disabled={!isAvailable}
                      className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                        selectedWallet === wallet.id
                          ? "border-blue-500 bg-blue-500/10"
                          : "border-neutral-700 hover:border-neutral-600 bg-neutral-800/50"
                      } ${!isAvailable ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <WalletLogo name={wallet.name} />
                      <div className="text-left">
                        <p className="text-sm font-medium text-neutral-200">{wallet.name}</p>
                        <p className="text-xs text-neutral-400">
                          {isAvailable ? "Click to connect" : "Not installed"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {freighterInstalled === null && (
                <div className="flex justify-center py-2">
                  <Spinner className="h-6 w-6 text-neutral-400" />
                </div>
              )}
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

        {isError && !showNotInstalled && (
          <>
            <button
              type="button"
              onClick={() => {
                handleDismissError();
                onClose();
              }}
              className={secondaryButtonClassName()}
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={handleConnect}
              disabled={isLoading}
              className={primaryButtonClassName()}
            >
              Try again
            </button>
          </>
        )}

        {showNotInstalled && !isConnected && (
          <>
            <button
              type="button"
              onClick={() => {
                if (isError) handleDismissError();
                onClose();
              }}
              className={secondaryButtonClassName()}
            >
              Continue without wallet
            </button>
            <button
              type="button"
              onClick={handleConnect}
              disabled={isLoading || freighterInstalled === false}
              className={primaryButtonClassName()}
            >
              {freighterInstalled === false ? "Install to connect" : "Connect"}
            </button>
          </>
        )}

        {!isConnecting &&
          !isConnected &&
          !isError &&
          freighterInstalled !== false && (
            <>
              <button
                type="button"
                onClick={onClose}
                className={secondaryButtonClassName()}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConnect}
                disabled={isLoading || freighterInstalled !== true}
                className={primaryButtonClassName()}
                data-testid="wallet-connect-button"
              >
                {freighterInstalled === null
                  ? "Checking…"
                  : selectedWallet
                    ? `Connect with ${WALLET_OPTIONS.find(w => w.id === selectedWallet)?.name || "Wallet"}`
                    : "Connect Wallet"}
              </button>
            </>
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
    <span className="font-mono text-sm">{truncateAddress(session.address)}</span>
  );
}
