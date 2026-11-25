"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  isLedgerWebHidSupported,
  isLedgerWebUsbSupported,
  buildStellarPath,
  openLedgerDevice,
  HardwareWalletConnectionError,
  type HardwareWalletSession,
  type LedgerStellarBridge,
} from "@/app/lib/hardwareWallet";

export type LedgerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConnected: (
    session: HardwareWalletSession,
    bridge?: LedgerStellarBridge,
  ) => void;
  txHashToSign?: string;
  onSignComplete?: (signature: string) => void;
};

export type ProtocolType = "webhid" | "webusb";

export function LedgerModal({
  isOpen,
  onClose,
  onConnected,
  txHashToSign,
  onSignComplete,
}: LedgerModalProps) {
  const [protocol, setProtocol] = useState<ProtocolType>("webhid");
  const [accountIndex, setAccountIndex] = useState<number>(0);
  const [customPath, setCustomPath] = useState<string>("");
  const [useCustomPath, setUseCustomPath] = useState<boolean>(false);

  const [isHidSupported, setIsHidSupported] = useState<boolean>(true);
  const [isUsbSupported, setIsUsbSupported] = useState<boolean>(true);

  const [step, setStep] = useState<
    | "connect"
    | "connecting"
    | "prompt_device"
    | "connected"
    | "signing"
    | "error"
  >("connect");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [devicePrompt, setDevicePrompt] = useState<string | null>(null);
  const [bridge, setBridge] = useState<LedgerStellarBridge | null>(null);

  useEffect(() => {
    isLedgerWebHidSupported().then(setIsHidSupported);
    isLedgerWebUsbSupported().then(setIsUsbSupported);
  }, []);

  const activePath =
    useCustomPath && customPath.trim()
      ? customPath.trim()
      : buildStellarPath(accountIndex);

  const handleConnect = useCallback(async () => {
    setErrorMsg(null);
    setStep("connecting");
    setDevicePrompt(
      "Please select your Ledger device from the browser prompt...",
    );

    try {
      // Open ledger device via WebUSB/WebHID bridge
      const devBridge = await openLedgerDevice();
      setBridge(devBridge);
      setStep("prompt_device");
      setDevicePrompt(
        "Open the Stellar app on your Ledger device and verify your address...",
      );

      // Get address with the chosen BIP-44 derivation path
      const result = await devBridge.getAddress({
        path: activePath,
        verifyOnDevice: false,
      });

      setPublicKey(result.address);
      setStep("connected");
      setDevicePrompt(null);

      const session: HardwareWalletSession = {
        kind: "ledger",
        address: result.address,
        transport: protocol,
        device: {
          productName: "Ledger Nano S/X/Plus",
          vendorId: 0x2c97,
        },
      };

      onConnected(session, devBridge);
    } catch (err: unknown) {
      setStep("error");
      if (err instanceof HardwareWalletConnectionError) {
        if (err.code === "device_locked") {
          setErrorMsg(
            "Ledger is locked. Please enter your PIN on the device and try again.",
          );
        } else if (
          err.code === "permission_denied" ||
          err.code === "device_not_selected"
        ) {
          setErrorMsg("Device connection request was cancelled or denied.");
        } else {
          setErrorMsg(
            err.message || "Failed to communicate with Ledger device.",
          );
        }
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(
          "Failed to connect to Ledger device. Ensure the Stellar app is open.",
        );
      }
    }
  }, [activePath, protocol, onConnected]);

  const handleSignTransaction = useCallback(async () => {
    if (!bridge || !txHashToSign) return;
    setStep("signing");
    setErrorMsg(null);
    setDevicePrompt(
      "Review and approve transaction hash on your Ledger screen...",
    );

    try {
      const signResult = await bridge.signTransaction(txHashToSign, {
        path: activePath,
      });
      setStep("connected");
      setDevicePrompt(null);
      if (onSignComplete) {
        onSignComplete(signResult.signature);
      }
    } catch (err: unknown) {
      setStep("error");
      if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Transaction signing rejected or failed on Ledger.");
      }
    }
  }, [bridge, txHashToSign, activePath, onSignComplete]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 font-bold text-lg border border-blue-500/30">
              L
            </div>
            <div>
              <h2 className="text-xl font-bold">Ledger Hardware Wallet</h2>
              <p className="text-xs text-slate-400">
                Nano S / Nano X / Nano S Plus via {protocol.toUpperCase()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Protocol Selector */}
        <div className="mt-4 flex gap-2 rounded-xl bg-slate-950 p-1 border border-slate-800">
          <button
            type="button"
            onClick={() => setProtocol("webhid")}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
              protocol === "webhid"
                ? "bg-blue-600 text-white shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            WebHID {!isHidSupported && "(Unsupported)"}
          </button>
          <button
            type="button"
            onClick={() => setProtocol("webusb")}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
              protocol === "webusb"
                ? "bg-blue-600 text-white shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            WebUSB {!isUsbSupported && "(Unsupported)"}
          </button>
        </div>

        {/* Blind-Signing Safety Warning */}
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <div className="font-semibold flex items-center gap-1.5 mb-1">
            <span>⚠️</span> Blind-Signing Safety Warning
          </div>
          <p className="text-amber-300/90 leading-relaxed">
            Smart contract automation on Soroban requires blind-signing enabled
            in your Ledger Stellar app settings. Always cross-reference the
            transaction hash on this screen with the hash displayed on your
            physical device.
          </p>
        </div>

        {/* BIP-44 Derivation Path Selection */}
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold text-slate-300">
              BIP-44 Derivation Path
            </span>
            <button
              type="button"
              onClick={() => setUseCustomPath(!useCustomPath)}
              className="text-blue-400 hover:underline"
            >
              {useCustomPath ? "Use Standard Path" : "Custom Path"}
            </button>
          </div>

          {!useCustomPath ? (
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-400">Account Index:</label>
              <select
                value={accountIndex}
                onChange={(e) => setAccountIndex(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
              >
                {[0, 1, 2, 3, 4, 5].map((idx) => (
                  <option key={idx} value={idx}>
                    Account #{idx} (44&apos;/148&apos;/{idx}&apos;)
                  </option>
                ))}
              </select>
              <span className="text-xs font-mono text-slate-500">
                {activePath}
              </span>
            </div>
          ) : (
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="e.g. 44'/148'/0'"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-mono text-white"
            />
          )}
        </div>

        {/* Security / Zero-exposure badge */}
        <div className="mt-4 flex items-center gap-2 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <span>🛡️</span>
          <span>
            Zero Private Key Exposure: Private keys never leave Ledger&apos;s
            Secure Element (EAL6+).
          </span>
        </div>

        {/* Status Prompt / Error / Result */}
        {devicePrompt && (
          <div className="mt-4 animate-pulse rounded-xl border border-blue-500/40 bg-blue-500/10 p-4 text-center text-sm font-medium text-blue-300">
            {devicePrompt}
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300">
            <span className="font-semibold block mb-1">Connection Error</span>
            {errorMsg}
          </div>
        )}

        {publicKey && (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs">
            <span className="text-slate-400 block mb-1">
              Connected Stellar Address:
            </span>
            <span className="font-mono text-emerald-400 break-all">
              {publicKey}
            </span>
          </div>
        )}

        {txHashToSign && step === "connected" && (
          <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-900/20 p-4 text-xs">
            <span className="text-slate-300 block font-semibold mb-1">
              Pending Transaction Hash:
            </span>
            <span className="font-mono text-blue-300 break-all">
              {txHashToSign}
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>

          {step !== "connected" ? (
            <button
              type="button"
              onClick={handleConnect}
              disabled={step === "connecting" || step === "prompt_device"}
              className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {step === "connecting" || step === "prompt_device"
                ? "Connecting..."
                : "Connect Ledger"}
            </button>
          ) : txHashToSign ? (
            <button
              type="button"
              onClick={handleSignTransaction}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Sign on Ledger
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
