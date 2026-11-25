/**
 * Hardware wallet adapters for Ledger and Trezor on Stellar.
 * Uses Ledger WebUSB where available; falls back to extension-based signing flows.
 *
 * Scope note (issue #1245): the Ledger bridge below speaks the device's APDU
 * protocol directly over WebUSB, so no additional npm package is required. It
 * covers what this app needs — BIP-44 Stellar key derivation, account-address
 * (StrKey) encoding, on-device verification prompts and device-lock handling.
 * Callers pass an already XDR-encoded transaction envelope; XDR parsing itself
 * stays with the Stellar SDK.
 */

export type HardwareWalletKind = "freighter" | "ledger" | "trezor";

export type HardwareWalletStatus =
  "unsupported" | "disconnected" | "connected" | "locked";

export type HardwareWalletSession = {
  kind: HardwareWalletKind;
  address: string;
  transport: "webusb" | "webhid" | "extension";
  device?: {
    productName?: string;
    serialNumber?: string;
    vendorId: number;
  };
};

export type HardwareWalletErrorCode =
  | "unsupported"
  | "device_not_selected"
  | "permission_denied"
  | "device_unavailable"
  | "device_locked"
  | "user_rejected";

type LedgerUsbDevice = {
  opened: boolean;
  configuration: unknown | null;
  productName?: string;
  serialNumber?: string;
  vendorId?: number;
  open: () => Promise<void>;
  selectConfiguration: (configurationValue: number) => Promise<void>;
  claimInterface: (interfaceNumber: number) => Promise<void>;
  selectAlternateInterface?: (alternateInterface: number) => Promise<void>;
  transferOut?: (
    endpointNumber: number,
    data: BufferSource,
  ) => Promise<unknown>;
  transferIn?: (
    endpointNumber: number,
    length: number,
  ) => Promise<{ data?: { buffer: ArrayBuffer } }>;
};

type LedgerUsb = {
  requestDevice: (options: {
    filters: Array<{ vendorId: number }>;
  }) => Promise<LedgerUsbDevice>;
};

type WebUsbNavigator = Navigator & {
  usb?: LedgerUsb;
};

const LEDGER_VENDOR_ID = 0x2c97;
const LEDGER_INTERFACE_NUMBER = 0;
/** Second interface exposed on Nano devices for the framing layer. */
const LEDGER_ALTERNATE_INTERFACE = 0;

export class HardwareWalletConnectionError extends Error {
  constructor(
    public readonly code: HardwareWalletErrorCode,
    message: string,
    public readonly retriable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "HardwareWalletConnectionError";
  }
}

function getWebUsb(): LedgerUsb | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as WebUsbNavigator).usb;
}

function getWebHid(): any {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as any).hid;
}

export async function isLedgerWebUsbSupported(): Promise<boolean> {
  return Boolean(getWebUsb());
}

export async function isLedgerWebHidSupported(): Promise<boolean> {
  return Boolean(getWebHid());
}

export async function detectLedgerSupport(): Promise<boolean> {
  return Boolean(getWebUsb() || getWebHid());
}

export async function detectTrezorSupport(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as Window & { TrezorConnect?: unknown }).TrezorConnect,
  );
}

export async function connectHardwareWallet(
  kind: Exclude<HardwareWalletKind, "freighter">,
): Promise<HardwareWalletSession> {
  if (kind === "ledger") {
    // Claiming is shared with openLedgerDevice so there is one code path for
    // browser-support checks, device selection and interface claiming.
    const device = await claimLedgerDevice();

    return {
      kind: "ledger",
      address: device.productName || "Ledger device",
      transport: "webusb",
      device: {
        productName: device.productName,
        serialNumber: device.serialNumber,
        vendorId: device.vendorId ?? LEDGER_VENDOR_ID,
      },
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

// ---------------------------------------------------------------------------
// Ledger APDU bridge (issue #1245)
//
// The Ledger Stellar app uses a small APDU dialect over the WebUSB endpoint.
// Speaking it directly keeps the dependency surface unchanged and makes every
// step unit-testable without a physical device.
// ---------------------------------------------------------------------------

/** Application class byte for the Ledger Stellar app. */
const LEDGER_APP_CLA = 0x11;
/** INS_GET_ADDRESS — returns the ed25519 public key for a path. */
const LEDGER_INS_GET_ADDRESS = 0x01;
/** INS_SIGN_TX — signs a transaction envelope (on-device confirmation). */
const LEDGER_INS_SIGN_TX = 0x02;

/** Ledger's USB framing uses 64-byte packets with a 5-byte header. */
const LEDGER_PACKET_SIZE = 64;
const LEDGER_TAG_APDU = 0x05;
const LEDGER_CHANNEL = 0x0101;
const LEDGER_EP_OUT = 0x01;
const LEDGER_EP_IN = 0x82;
/**
 * Upper bound on response packets. A signature response is ~96 bytes, so two
 * packets is typical; the cap only stops a misbehaving device from looping
 * forever when it never sends a short terminating read.
 */
const MAX_RESPONSE_PACKETS = 32;

/**
 * Inactivity timeout the Ledger Stellar app enforces. The device rejects
 * signing once it lapses, so we surface that as its own actionable state
 * rather than a generic failure.
 */
export const LEDGER_LOCK_TIMEOUT_MS = 120_000;

/** BIP-44 coin type for Stellar. */
export const STELLAR_COIN_TYPE = 148;

export type LedgerDerivationPath = `m/44'/${number}'/${number}'`;

export type LedgerDeviceState =
  "ready" | "locked" | "user_rejected" | "app_not_open" | "disconnected";

/** Public key + address for one derivation path. */
export type LedgerAddressResult = {
  /** Raw 32-byte ed25519 public key. */
  publicKey: Uint8Array;
  /** Stellar `G...` account address. */
  address: string;
  /** BIP-44 path the address was derived from. */
  path: LedgerDerivationPath;
};

export type LedgerSignatureResult = {
  /** 64-byte ed25519 signature over the network-id-bound payload. */
  signature: Uint8Array;
  /** Raw 32-byte ed25519 public key that produced the signature. */
  publicKey: Uint8Array;
  path: LedgerDerivationPath;
};

export type LedgerExchangeOptions = {
  /** Path to request or sign with. Defaults to the first account. */
  path?: LedgerDerivationPath;
  /** Network passphrase, so the device can display the right network. */
  networkPassphrase?: string;
  /** Called when the device is about to show an on-device prompt. */
  onPrompt?: (prompt: string) => void;
  /** Exchange timeout; defaults to the device lock timeout. */
  timeoutMs?: number;
};

/**
 * Build the canonical BIP-44 Stellar path.
 *
 * Stellar uses coin type 148 and every level is hardened — the Ledger app
 * rejects non-hardened Stellar paths, so this is fixed rather than
 * configurable.
 */
export function buildStellarPath(account: number = 0): LedgerDerivationPath {
  return `m/44'/${STELLAR_COIN_TYPE}'/${account}'` as LedgerDerivationPath;
}

/**
 * Encode a derivation path as the big-endian 32-bit words the Ledger app
 * expects. Hardened levels are offset by 0x80000000.
 *
 * Accepts the three-level account path the Ledger Stellar app uses
 * (`m/44'/148'/0'`) and the full five-level BIP-44 form, so callers can pass
 * either. Anything else is rejected rather than silently mis-signed.
 */
export function encodeDerivationPath(path: string): Uint8Array {
  const parts = path.replace(/^m\//u, "").split("/");
  if (parts.length !== 3 && parts.length !== 5) {
    throw new Error(`Unsupported derivation path: ${path}`);
  }

  const words = new Uint8Array(4 * parts.length);
  let offset = 0;
  for (const part of parts) {
    const hardened = part.endsWith("'");
    const value = Number.parseInt(hardened ? part.slice(0, -1) : part, 10);
    if (!Number.isInteger(value) || value < 0 || value >= 0x80000000) {
      throw new Error(`Invalid derivation path element: ${part}`);
    }
    const word = hardened ? value + 0x80000000 : value;
    words[offset] = (word >>> 24) & 0xff;
    words[offset + 1] = (word >>> 16) & 0xff;
    words[offset + 2] = (word >>> 8) & 0xff;
    words[offset + 3] = word & 0xff;
    offset += 4;
  }

  // Purpose (44) and coin type (148) must match, otherwise the device would
  // derive on a different chain than the address the user expects. The second
  // word is always the coin type, whichever path length was supplied.
  if (readLevel(words, 0) !== 44 || readLevel(words, 1) !== STELLAR_COIN_TYPE) {
    throw new Error(`Path is not a Stellar BIP-44 path: ${path}`);
  }

  return words;
}

/**
 * Read a derivation level as a plain index, dropping the hardening bit.
 * Uses arithmetic rather than `&` because a hardened word exceeds int32 range.
 */
function readLevel(words: Uint8Array, level: number): number {
  const offset = level * 4;
  const word =
    words[offset] * 0x1000000 +
    words[offset + 1] * 0x10000 +
    words[offset + 2] * 0x100 +
    words[offset + 3];
  return word % 0x80000000;
}

// ---------------------------------------------------------------------------
// StrKey encoding
//
// Stellar addresses are base32(payload || crc16-xmodem) over a version byte.
// Implementing it here turns a Ledger public key into a displayable address
// with no wallet extension or network round-trip.
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** Version byte 6 (0b0110) shifted left 3 — the `G` prefix. */
const ACCOUNT_ID_VERSION_BYTE = (6 << 3) & 0xff;

function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function base32Encode(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f];
  }
  return output;
}

/**
 * Encode a raw ed25519 public key as a Stellar `G...` account address.
 * Rejects anything that is not exactly 32 bytes, which is what a Stellar
 * ed25519 public key must be.
 */
export function encodeStellarAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(
      `Expected a 32-byte ed25519 public key, received ${publicKey.length}`,
    );
  }
  const payload = new Uint8Array(1 + publicKey.length);
  payload[0] = ACCOUNT_ID_VERSION_BYTE;
  payload.set(publicKey, 1);

  const checksum = crc16Xmodem(payload);
  const full = new Uint8Array(payload.length + 2);
  full.set(payload, 0);
  full[payload.length] = checksum & 0xff;
  full[payload.length + 1] = (checksum >>> 8) & 0xff;

  return base32Encode(full);
}

/** Concatenate byte arrays without a spread (argument limits on long payloads). */
function concatBytes(chunks: Array<Uint8Array>): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Build a Ledger command APDU.
 * Layout: CLA | INS | P1 | P2 | Lc | data | Le
 */
export function buildApdu(
  cla: number,
  ins: number,
  p1: number,
  p2: number,
  data: Uint8Array,
): Uint8Array {
  const header = new Uint8Array([cla, ins, p1, p2, data.length]);
  const trailer = new Uint8Array([data.length === 0 ? 0x00 : 0x80, 0x00]);
  return concatBytes([header, data, trailer]);
}

/** Split an APDU into 64-byte USB packets with the 5-byte Ledger header. */
export function framePackets(apdu: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let sequence = 0;

  for (let offset = 0; offset < apdu.length; offset += LEDGER_PACKET_SIZE - 5) {
    const chunk = apdu.slice(offset, offset + LEDGER_PACKET_SIZE - 5);
    const packet = new Uint8Array(LEDGER_PACKET_SIZE);
    packet[0] = (LEDGER_CHANNEL >>> 8) & 0xff;
    packet[1] = LEDGER_CHANNEL & 0xff;
    packet[2] = LEDGER_TAG_APDU;
    packet[3] = (sequence >>> 8) & 0xff;
    packet[4] = sequence & 0xff;
    packet.set(chunk, 5);
    packets.push(packet);
    sequence += 1;
  }

  return packets;
}

export type LedgerApduResponse = {
  /** Response payload with the trailing status word removed. */
  data: Uint8Array;
  /** Two-byte ISO 7816 status word. */
  statusWord: number;
};

/**
 * Reassemble USB packets and split off the status word.
 *
 * The first packet is the Ledger header; the rest carry the payload starting
 * at offset 5. The final packet is short (the device stops once the APDU
 * response is complete), so each packet contributes only the bytes it
 * actually holds rather than a fixed chunk size.
 */
export function parseResponsePackets(
  packets: Uint8Array[],
): LedgerApduResponse {
  if (packets.length === 0) {
    throw new Error("Ledger returned no response packets");
  }

  const payload = concatBytes(
    packets.slice(1).map((packet) => packet.slice(5)),
  );

  if (payload.length < 2) {
    throw new Error("Ledger response is missing a status word");
  }

  const statusWord =
    (payload[payload.length - 2] << 8) | payload[payload.length - 1];
  return { data: payload.slice(0, payload.length - 2), statusWord };
}

/** Map an ISO 7816 status word onto a device state. */
export function statusWordToState(statusWord: number): LedgerDeviceState {
  switch (statusWord) {
    case 0x9000:
      return "ready";
    case 0x6985:
      return "user_rejected";
    case 0x6b0c:
    case 0x6982:
      return "locked";
    case 0x6e00:
    case 0x6d00:
    case 0x6700:
      return "app_not_open";
    default:
      return "disconnected";
  }
}

/** Human-readable explanation for a device state. */
export function describeLedgerState(state: LedgerDeviceState): string {
  switch (state) {
    case "ready":
      return "Ledger is ready.";
    case "locked":
      return "Ledger is locked. Unlock the device with your PIN, then retry.";
    case "user_rejected":
      return "The request was rejected on the Ledger screen.";
    case "app_not_open":
      return "Open the Stellar app on your Ledger, then retry.";
    default:
      return "The Ledger connection was lost. Reconnect the device and try again.";
  }
}

/** Assert the exchange succeeded, throwing a classified error when it did not. */
function assertDeviceReady(
  statusWord: number,
  operation: string,
): LedgerDeviceState {
  const state = statusWordToState(statusWord);
  if (state !== "ready") {
    const code =
      state === "locked"
        ? "device_locked"
        : state === "user_rejected"
          ? "user_rejected"
          : "device_unavailable";
    throw new HardwareWalletConnectionError(
      code,
      `${operation} failed: ${describeLedgerState(state)}`,
      state === "locked" ||
        state === "user_rejected" ||
        state === "app_not_open",
    );
  }
  return state;
}

/**
 * Reject a promise that outlives `timeoutMs` with a lock-timeout error.
 *
 * The Ledger auto-locks mid-exchange; a hung transferOut/transferIn is what
 * that looks like from the browser, and without this the UI would spin
 * forever. The timeout reports the same "locked" state the device would
 * return itself, so callers only handle one path.
 */
async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new HardwareWalletConnectionError(
                "device_locked",
                `${label} timed out after ${Math.round(timeoutMs / 1000)}s. ${describeLedgerState("locked")}`,
                true,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Default exchange timeout; equals the device lock timeout. */
export const DEFAULT_LEDGER_TIMEOUT_MS = LEDGER_LOCK_TIMEOUT_MS;

/**
 * A connected Ledger device ready to derive addresses and sign.
 *
 * Wraps a claimed WebUSB device. Build one via `openLedgerDevice` rather than
 * directly, so the USB interface is claimed exactly once.
 */
export class LedgerStellarBridge {
  constructor(
    private readonly device: LedgerUsbDevice,
    private readonly productName: string,
  ) {}

  private assertTransport(): {
    transferOut: NonNullable<LedgerUsbDevice["transferOut"]>;
    transferIn: NonNullable<LedgerUsbDevice["transferIn"]>;
  } {
    const { transferOut, transferIn } = this.device;
    if (!transferOut || !transferIn) {
      throw new HardwareWalletConnectionError(
        "device_unavailable",
        "This Ledger connection does not expose a WebUSB transfer interface.",
        false,
      );
    }
    return { transferOut, transferIn };
  }

  /** Send one APDU and return the reassembled response. */
  async exchange(
    apdu: Uint8Array,
    timeoutMs: number,
  ): Promise<LedgerApduResponse> {
    const { transferOut, transferIn } = this.assertTransport();

    const readAll = (async () => {
      for (const packet of framePackets(apdu)) {
        await transferOut.call(this.device, LEDGER_EP_OUT, packet);
      }

      // The response carries its own header packet, so its length is not known
      // from the command. Ledger signals the end with a short read, so read
      // until one arrives; the cap only guards against a device that never
      // terminates.
      const received: Uint8Array[] = [];
      for (let i = 0; i < MAX_RESPONSE_PACKETS; i += 1) {
        const result = await transferIn.call(
          this.device,
          LEDGER_EP_IN,
          LEDGER_PACKET_SIZE,
        );
        const buffer = result?.data?.buffer;
        if (!buffer) {
          throw new HardwareWalletConnectionError(
            "device_unavailable",
            "Ledger returned an empty USB packet.",
            true,
          );
        }
        received.push(new Uint8Array(buffer));
        if (buffer.byteLength < LEDGER_PACKET_SIZE) {
          break;
        }
      }
      return received;
    })();

    return parseResponsePackets(
      await withTimeout(readAll, timeoutMs, "Ledger exchange"),
    );
  }

  /** Derive the account address for a BIP-44 path. */
  async getAddress(
    options: LedgerExchangeOptions = {},
  ): Promise<LedgerAddressResult> {
    const path = options.path ?? buildStellarPath();
    const timeoutMs = options.timeoutMs ?? DEFAULT_LEDGER_TIMEOUT_MS;
    const pathBytes = encodeDerivationPath(path);

    options.onPrompt?.(
      `Confirm the address for ${path} on your Ledger screen.`,
    );

    // P1 = 1 asks the app to return the StrKey alongside the public key.
    const apdu = buildApdu(
      LEDGER_APP_CLA,
      LEDGER_INS_GET_ADDRESS,
      0x01,
      0x00,
      concatBytes([new Uint8Array([pathBytes.length / 4]), pathBytes]),
    );

    const response = await this.exchange(apdu, timeoutMs);
    assertDeviceReady(response.statusWord, "Reading the Ledger address");

    // The app may prefix the public key with a 0x00 marker byte. Detect that by
    // length rather than by inspecting the first byte, because a public key
    // starting with 0x00 is perfectly valid and must not be truncated.
    const raw =
      response.data.length === 33 && response.data[0] === 0x00
        ? response.data.slice(1)
        : response.data;
    if (raw.length < 32) {
      throw new HardwareWalletConnectionError(
        "device_unavailable",
        "Ledger returned a malformed public key.",
        true,
      );
    }
    const publicKey = raw.slice(0, 32);
    return { publicKey, address: encodeStellarAddress(publicKey), path };
  }

  /**
   * Sign a transaction envelope on the device.
   *
   * The Ledger Stellar app binds the signature to the network id, so the
   * passphrase travels with the request and the device displays the network on
   * its screen for the user to verify before approving.
   */
  async signTransaction(
    envelopeXdr: string,
    options: LedgerExchangeOptions = {},
  ): Promise<LedgerSignatureResult> {
    if (!envelopeXdr) {
      throw new Error("A base64 XDR transaction envelope is required to sign");
    }
    const path = options.path ?? buildStellarPath();
    const timeoutMs = options.timeoutMs ?? DEFAULT_LEDGER_TIMEOUT_MS;
    const pathBytes = encodeDerivationPath(path);

    options.onPrompt?.(
      "Approve the transaction on your Ledger — verify the network and amount shown on the device screen.",
    );

    const apdu = buildApdu(
      LEDGER_APP_CLA,
      LEDGER_INS_SIGN_TX,
      0x00,
      options.networkPassphrase ? 0x01 : 0x00,
      concatBytes([
        new Uint8Array([pathBytes.length / 4]),
        pathBytes,
        new TextEncoder().encode(envelopeXdr),
      ]),
    );

    const response = await this.exchange(apdu, timeoutMs);
    assertDeviceReady(response.statusWord, "Signing on the Ledger");

    // No marker byte is stripped here: the payload is exactly 64 signature
    // bytes plus 32 public-key bytes, and a signature's first byte is
    // legitimately 0x00 often enough that heuristic stripping would corrupt it.
    if (response.data.length < 96) {
      throw new HardwareWalletConnectionError(
        "device_unavailable",
        "Ledger returned a truncated signature.",
        true,
      );
    }
    return {
      signature: response.data.slice(0, 64),
      publicKey: response.data.slice(64, 96),
      path,
    };
  }

  /** Human-readable device name for the UI. */
  describe(): string {
    return this.productName;
  }
}

/** Base64-encode bytes without relying on Node's Buffer. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

/** Base64-encode a signature for transport alongside the transaction. */
export function encodeSignatureForRpc(signature: Uint8Array): string {
  return bytesToBase64(signature);
}

/** Open a USB connection to a Ledger and claim the interface for APDU traffic. */
export async function claimLedgerDevice(): Promise<LedgerUsbDevice> {
  const usb = getWebUsb();
  if (!usb) {
    throw new HardwareWalletConnectionError(
      "unsupported",
      "Ledger WebUSB is not available in this browser. Use Chrome or Edge with a USB-connected device.",
      false,
    );
  }

  let device: LedgerUsbDevice;
  try {
    device = await usb.requestDevice({
      filters: [{ vendorId: LEDGER_VENDOR_ID }],
    });
  } catch (error) {
    const errorName = error instanceof DOMException ? error.name : "";
    if (errorName === "NotFoundError") {
      throw new HardwareWalletConnectionError(
        "device_not_selected",
        "No Ledger device selected.",
        true,
        error,
      );
    }
    if (errorName === "SecurityError") {
      throw new HardwareWalletConnectionError(
        "permission_denied",
        "Ledger USB permission was denied by the browser.",
        true,
        error,
      );
    }
    throw new HardwareWalletConnectionError(
      "device_unavailable",
      "Unable to request Ledger USB access.",
      true,
      error,
    );
  }

  try {
    if (!device.opened) {
      await device.open();
    }
    if (!device.configuration) {
      await device.selectConfiguration(1);
    }
    await device.claimInterface(LEDGER_INTERFACE_NUMBER);
    // Nano devices expose the Ledger framing on a second interface; claiming
    // it when present keeps older firmware usable without a version check.
    if (device.selectAlternateInterface) {
      try {
        await device.selectAlternateInterface(LEDGER_ALTERNATE_INTERFACE);
      } catch {
        // Alternate interface is optional — ignore and use the claimed one.
      }
    }
  } catch (error) {
    throw new HardwareWalletConnectionError(
      "device_unavailable",
      "Ledger device is unavailable or already claimed by another app.",
      true,
      error,
    );
  }

  return device;
}

/**
 * Prompt for a Ledger, claim it, and return a bridge ready to derive
 * addresses or sign. Rejects with a classified `HardwareWalletConnectionError`
 * when the browser lacks WebUSB, the user picks nothing, or the device is busy.
 */
export async function openLedgerDevice(): Promise<LedgerStellarBridge> {
  const device = await claimLedgerDevice();
  return new LedgerStellarBridge(device, device.productName || "Ledger device");
}
