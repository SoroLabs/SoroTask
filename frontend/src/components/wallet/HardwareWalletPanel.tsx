"use client";

import { useCallback, useEffect, useState } from "react";
import {
  buildStellarPath,
  connectHardwareWallet,
  describeLedgerState,
  detectLedgerSupport,
  detectTrezorSupport,
  openLedgerDevice,
  statusWordToState,
  type HardwareWalletConnectionError,
  type HardwareWalletKind,
  type HardwareWalletSession,
  type LedgerAddressResult,
  type LedgerStellarBridge,
} from "@/app/lib/hardwareWallet";

type Props = {
  onSessionChange?: (session: HardwareWalletSession | null) => void;
};

/** Narrow an unknown catch to the classified connection error. */
function asConnectionError(error: unknown): HardwareWalletConnectionError | null {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return error as HardwareWalletConnectionError;
  }
  return null;
}

export function HardwareWalletPanel({ onSessionChange }: Props) {
  const [ledgerAvailable, setLedgerAvailable] = useState(false);
  const [trezorAvailable, setTrezorAvailable] = useState(false);
  const [session, setSession] = useState<HardwareWalletSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Ledger signing state. The bridge is kept in a ref-like state because it
  // wraps an open USB handle that must outlive a single render pass.
  const [bridge, setBridge] = useState<LedgerStellarBridge | null>(null);
  const [ledgerAddress, setLedgerAddress] = useState<LedgerAddressResult | null>(null);
  const [devicePrompt, setDevicePrompt] = useState<string | null>(null);
  const [readingAddress, setReadingAddress] = useState(false);

  useEffect(() => {
    detectLedgerSupport().then(setLedgerAvailable);
    detectTrezorSupport().then(setTrezorAvailable);
  }, []);

  const connect = useCallback(
    async (kind: HardwareWalletKind) => {
      if (kind === "freighter") return;
      setConnecting(true);
      setError(null);
      try {
        const next = await connectHardwareWallet(kind);
        setSession(next);
        onSessionChange?.(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Connection failed";
        setError(message);
        setSession(null);
        onSessionChange?.(null);
      } finally {
        setConnecting(false);
      }
    },
    [onSessionChange],
  );

  /**
   * Claim the device and read its address. Lock and rejection are reported as
   * their own states so the user knows to unlock or retry rather than being
   * told the connection generically failed.
   */
  const connectLedger = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setDevicePrompt(null);
    try {
      const opened = await openLedgerDevice();
      setBridge(opened);

      setReadingAddress(true);
      const derived = await opened.getAddress({
        path: buildStellarPath(0),
        onPrompt: setDevicePrompt,
      });
      setLedgerAddress(derived);

      setSession({
        kind: "ledger",
        address: derived.address,
        transport: "webusb",
        device: { productName: opened.describe(), vendorId: 0x2c97 },
      });
      onSessionChange?.({
        kind: "ledger",
        address: derived.address,
        transport: "webusb",
        device: { productName: opened.describe(), vendorId: 0x2c97 },
      });
    } catch (err) {
      const connectionError = asConnectionError(err);
      if (connectionError) {
        // Map the device's own status word back to a readable state.
        setError(
          connectionError.code === "device_locked" ||
            connectionError.code === "user_rejected"
            ? describeLedgerState(statusWordToState(
                connectionError.code === "device_locked" ? 0x6b0c : 0x6985,
              ))
            : connectionError.message,
        );
      } else {
        setError(err instanceof Error ? err.message : "Ledger connection failed");
      }
      setBridge(null);
      setLedgerAddress(null);
      setSession(null);
      onSessionChange?.(null);
    } finally {
      setReadingAddress(false);
      setConnecting(false);
    }
  }, [onSessionChange]);

  const disconnect = () => {
    setSession(null);
    setBridge(null);
    setLedgerAddress(null);
    setDevicePrompt(null);
    setError(null);
    onSessionChange?.(null);
  };

  return (
    <section
      data-onboarding="wallet"
      className="rounded-xl border border-neutral-700 bg-neutral-900/60 p-5"
    >
      <h2 className="text-lg font-semibold text-neutral-100">Hardware wallet</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Sign batched task registrations with Ledger WebUSB or Trezor Connect.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!ledgerAvailable || connecting}
          onClick={connectLedger}
          className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-200 hover:border-blue-500 disabled:opacity-40"
        >
          {ledgerAvailable ? "Connect Ledger" : "Ledger unavailable"}
        </button>
        <button
          type="button"
          disabled={!trezorAvailable || connecting}
          onClick={() => connect("trezor")}
          className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-200 hover:border-blue-500 disabled:opacity-40"
        >
          {trezorAvailable ? "Connect Trezor" : "Trezor unavailable"}
        </button>
        {session ? (
          <button
            type="button"
            onClick={disconnect}
            className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-400"
          >
            Disconnect
          </button>
        ) : null}
      </div>

      {/* The user has to approve on the device itself, so mirror the prompt
          here rather than leaving the button apparently hung. */}
      {devicePrompt ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        >
          {devicePrompt}
        </p>
      ) : null}

      {readingAddress ? (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-neutral-400">
          Reading address from your Ledger…
        </p>
      ) : null}

      {session ? (
        <div className="mt-3 text-sm text-emerald-300">
          <p>
            Connected via {session.kind} ({session.transport}): {session.address}
          </p>
          {ledgerAddress ? (
            <p className="mt-1 text-xs text-neutral-400">
              Derivation path {ledgerAddress.path} · public key{" "}
              {Array.from(ledgerAddress.publicKey)
                .slice(0, 8)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")}
              …
              {bridge ? " · ready to sign" : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
