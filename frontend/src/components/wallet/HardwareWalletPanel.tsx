"use client";

import { useCallback, useEffect, useState } from "react";
import {
  connectHardwareWallet,
  detectLedgerSupport,
  detectTrezorSupport,
  type HardwareWalletKind,
  type HardwareWalletSession,
} from "@/app/lib/hardwareWallet";

type Props = {
  onSessionChange?: (session: HardwareWalletSession | null) => void;
};

export function HardwareWalletPanel({ onSessionChange }: Props) {
  const [ledgerAvailable, setLedgerAvailable] = useState(false);
  const [trezorAvailable, setTrezorAvailable] = useState(false);
  const [session, setSession] = useState<HardwareWalletSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

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

  const disconnect = () => {
    setSession(null);
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
        Sign batched task registrations with Ledger (WebHID) or Trezor Connect.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!ledgerAvailable || connecting}
          onClick={() => connect("ledger")}
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

      {session ? (
        <p className="mt-3 text-sm text-emerald-300">
          Connected via {session.kind} ({session.transport}): {session.address}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
