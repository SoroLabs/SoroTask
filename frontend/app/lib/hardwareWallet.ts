/**
 * Hardware wallet adapters for Ledger and Trezor on Stellar.
 * Uses WebHID where available; falls back to extension-based signing flows.
 */

export type HardwareWalletKind = "freighter" | "ledger" | "trezor";

export type HardwareWalletStatus =
  | "unsupported"
  | "disconnected"
  | "connected"
  | "locked";

export type HardwareWalletSession = {
  kind: HardwareWalletKind;
  address: string;
  transport: "webhid" | "extension";
};

export async function isWebHidSupported(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  return Boolean(navigator.hid);
}

export async function detectLedgerSupport(): Promise<boolean> {
  return isWebHidSupported();
}

export async function detectTrezorSupport(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return Boolean((window as Window & { TrezorConnect?: unknown }).TrezorConnect);
}

export async function connectHardwareWallet(
  kind: Exclude<HardwareWalletKind, "freighter">,
): Promise<HardwareWalletSession> {
  if (kind === "ledger") {
    if (!(await detectLedgerSupport())) {
      throw new Error(
        "Ledger WebHID is not available in this browser. Use Chrome or Edge with a USB-connected device.",
      );
    }
    const devices = await navigator.hid!.requestDevice({
      filters: [{ vendorId: 0x2c97 }],
    });
    if (!devices.length) {
      throw new Error("No Ledger device selected.");
    }
    return {
      kind: "ledger",
      address: "G_LEDGER_PLACEHOLDER",
      transport: "webhid",
    };
  }

  if (!(await detectTrezorSupport())) {
    throw new Error(
      "Trezor Connect is not loaded. Include the Trezor Connect script or use Freighter.",
    );
  }

  return {
    kind: "trezor",
    address: "G_TREZOR_PLACEHOLDER",
    transport: "extension",
  };
}
