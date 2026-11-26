/**
 * wallet.ts
 *
 * Thin wrapper around @stellar/freighter-api.
 * All Freighter calls are isolated here so the rest of the app never imports
 * the extension API directly — making it easy to mock in tests and swap
 * providers in the future.
 *
 * Freighter API reference: https://docs.freighter.app/docs/guide/usingFreighterWebApp
 */

import {
  isConnected,
  isAllowed,
  requestAccess,
  getAddress,
  getNetworkDetails,
  WatchWalletChanges,
} from "@stellar/freighter-api";
import {
  FreighterWalletProvider,
  AlbedoWalletProvider,
  XBullWalletProvider,
  LobstrWalletProvider,
} from "./wallet-providers";
import type {
  WalletProvider,
  WalletSignOptions,
  WalletSignResult,
} from "./wallet-provider";

export type NetworkDetails = {
  network: string;
  networkUrl: string;
  networkPassphrase: string;
  sorobanRpcUrl?: string;
};

export type WalletSession = {
  address: string;
  network: NetworkDetails;
  /** Provider that produced this session. */
  providerId?: SupportedWallet;
  /** BIP-44 path for hardware wallets (Ledger). */
  derivationPath?: string;
};

export type WalletError =
  | "NOT_INSTALLED"
  | "USER_REJECTED"
  | "WRONG_NETWORK"
  | "HARDWARE_ERROR"
  | "UNKNOWN";

export class WalletConnectionError extends Error {
  constructor(
    public readonly code: WalletError,
    message: string,
  ) {
    super(message);
    this.name = "WalletConnectionError";
  }
}

export { EXPECTED_NETWORK_PASSPHRASE } from "./wallet-constants";
import { EXPECTED_NETWORK_PASSPHRASE } from "./wallet-constants";

const E2E_MOCK_ADDRESS =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function isE2EMockWalletEnabled(): boolean {
  return process.env.NEXT_PUBLIC_E2E_MOCK_WALLET === "true";
}

function getE2EMockSession(): WalletSession {
  return {
    address: E2E_MOCK_ADDRESS,
    network: {
      network: "Futurenet",
      networkUrl: "https://horizon-futurenet.stellar.org",
      networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
      sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
    },
  };
}

/**
 * Returns true if the Freighter extension is installed in the browser.
 * Safe to call on the server — returns false when window is undefined.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  if (isE2EMockWalletEnabled()) return true;
  if (typeof window === "undefined") return false;
  try {
    const result = await isConnected();
    return result.isConnected;
  } catch {
    return false;
  }
}

/**
 * Returns true if the user has previously authorised this app in Freighter.
 */
export async function isAppAllowed(): Promise<boolean> {
  if (isE2EMockWalletEnabled()) return false;
  if (typeof window === "undefined") return false;
  try {
    const result = await isAllowed();
    return result.isAllowed;
  } catch {
    return false;
  }
}

/**
 * Prompts the user to connect their Freighter wallet.
 * - Triggers the Freighter permission popup on first visit.
 * - Returns the connected session (address + network details).
 * - Throws WalletConnectionError with a typed code on failure.
 */
export async function connectWallet(): Promise<WalletSession> {
  if (isE2EMockWalletEnabled()) {
    return getE2EMockSession();
  }

  // Clear the intentional disconnect flag so they can connect again
  if (typeof window !== "undefined") {
    localStorage.removeItem("sorotask_wallet_disconnected");
  }

  // 1. Check extension is installed
  const installed = await isFreighterInstalled();
  if (!installed) {
    throw new WalletConnectionError(
      "NOT_INSTALLED",
      "Freighter wallet extension is not installed. Please install it from https://www.freighter.app/",
    );
  }

  // 2. Request access (triggers popup if not yet allowed)
  const accessResult = await requestAccess();
  if (accessResult.error) {
    throw new WalletConnectionError(
      "USER_REJECTED",
      accessResult.error.message ?? "User rejected the connection request.",
    );
  }

  const address = accessResult.address;
  if (!address) {
    throw new WalletConnectionError(
      "USER_REJECTED",
      "No address returned from Freighter.",
    );
  }

  // 3. Fetch network details
  // Add a small delay to prevent race conditions in the Freighter extension's internal state
  await new Promise((resolve) => setTimeout(resolve, 500));

  let networkResult = await getNetworkDetails();

  // Retry once if it fails, just in case Freighter's message port isn't fully ready
  if (networkResult.error) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    networkResult = await getNetworkDetails();
  }

  if (networkResult.error) {
    throw new WalletConnectionError(
      "UNKNOWN",
      networkResult.error.message ?? "Failed to retrieve network details.",
    );
  }

  const networkDetails: NetworkDetails = {
    network: networkResult.network,
    networkUrl: networkResult.networkUrl,
    networkPassphrase: networkResult.networkPassphrase,
    sorobanRpcUrl: networkResult.sorobanRpcUrl,
  };

  // 4. Warn if the user is on the wrong network (non-blocking — UI layer decides)
  if (networkDetails.networkPassphrase !== EXPECTED_NETWORK_PASSPHRASE) {
    throw new WalletConnectionError(
      "WRONG_NETWORK",
      `SoroTask requires the Futurenet network. Your wallet is connected to "${networkDetails.network}". Please switch networks in Freighter.`,
    );
  }

  return { address, network: networkDetails };
}

const withTimeout = <T>(promise: Promise<T>, ms: number = 3000): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ]);
};

/**
 * Silently re-hydrates the session if the user has already authorised the app.
 * Returns null if Freighter is not installed, not allowed, or returns no address.
 * Never throws — safe to call on mount.
 */
export async function restoreSession(): Promise<WalletSession | null> {
  if (isE2EMockWalletEnabled()) return null;
  if (typeof window === "undefined") return null;

  // If the user explicitly disconnected, do not auto-rehydrate.
  if (localStorage.getItem("sorotask_wallet_disconnected") === "true") {
    return null;
  }

  try {
    const allowed = await withTimeout(isAppAllowed());
    if (!allowed) return null;

    const addressResult = await withTimeout(getAddress());
    if (addressResult.error || !addressResult.address) return null;

    const networkResult = await withTimeout(getNetworkDetails());
    if (networkResult.error) return null;

    // Enforce Futurenet on page reload
    if (networkResult.networkPassphrase !== EXPECTED_NETWORK_PASSPHRASE) {
      return null;
    }

    return {
      address: addressResult.address,
      network: {
        network: networkResult.network,
        networkUrl: networkResult.networkUrl,
        networkPassphrase: networkResult.networkPassphrase,
        sorobanRpcUrl: networkResult.sorobanRpcUrl,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Starts watching for wallet changes (account switch, network switch).
 * Returns a cleanup function — call it in useEffect cleanup.
 *
 * @param onUpdate  Called whenever address or network changes.
 * @param pollMs    How often to poll Freighter (default 3000ms).
 */
export function watchWalletChanges(
  onUpdate: (session: WalletSession | null) => void,
  pollMs = 3000,
): () => void {
  if (isE2EMockWalletEnabled()) {
    return () => {};
  }

  const watcher = new WatchWalletChanges(pollMs);

  watcher.watch(({ address, network, networkPassphrase }) => {
    // If no address or wrong network, disconnect immediately
    if (!address || networkPassphrase !== EXPECTED_NETWORK_PASSPHRASE) {
      onUpdate(null);
      return;
    }
    onUpdate({
      address,
      network: {
        network,
        networkUrl: "",
        networkPassphrase,
      },
    });
  });

  return () => watcher.stop();
}

/**
 * Truncates a Stellar address for display: "GABCD...XYZ1"
 */
export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars + 1)}...${address.slice(-chars)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-wallet unified adapter
// ─────────────────────────────────────────────────────────────────────────────

export type SupportedWallet =
  "freighter" | "albedo" | "xbull" | "lobstr" | "ledger";

/** Wallets that connect through a browser extension or web popup. */
export type BrowserWalletId = Exclude<SupportedWallet, "ledger">;

export interface WalletProviderMeta {
  id: SupportedWallet;
  name: string;
  description: string;
  installUrl?: string;
  kind: "browser" | "web" | "hardware";
}

/**
 * Single source of truth for the wallet hub UI. Order is intentional: the
 * extension wallets most users already have come first, with Ledger last.
 */
export const WALLET_PROVIDERS_META: readonly WalletProviderMeta[] = [
  {
    id: "freighter",
    name: "Freighter",
    description: "Browser extension for Stellar",
    installUrl: "https://www.freighter.app/",
    kind: "browser",
  },
  {
    id: "xbull",
    name: "xBull",
    description: "Stellar browser extension",
    installUrl: "https://xbull.app/",
    kind: "browser",
  },
  {
    id: "albedo",
    name: "Albedo",
    description: "Web-based Stellar wallet",
    installUrl: "https://albedo.link/",
    kind: "web",
  },
  {
    id: "lobstr",
    name: "LOBSTR",
    description: "Mobile & web Stellar wallet (WalletConnect)",
    installUrl: "https://lobstr.co/",
    kind: "web",
  },
  {
    id: "ledger",
    name: "Ledger",
    description: "Hardware wallet via WebUSB / WebHID",
    installUrl: "https://www.ledger.com/ledger-live",
    kind: "hardware",
  },
] as const;

const STORAGE_KEY = "sorotask_wallet_session";
const DISCONNECT_KEY = "sorotask_wallet_disconnected";

export interface StoredWalletSession {
  providerId: SupportedWallet;
  address: string;
  networkPassphrase: string;
  network: string;
  networkUrl: string;
  sorobanRpcUrl?: string;
  /** BIP-44 path persisted for Ledger session reconnection. */
  derivationPath?: string;
  timestamp: number;
}

/**
 * Persist the active wallet session. Metadata only — private keys never leave
 * the wallet or hardware device.
 */
export function saveWalletSession(
  session: WalletSession,
  providerId: SupportedWallet,
  derivationPath?: string,
): void {
  if (typeof window === "undefined") return;
  const stored: StoredWalletSession = {
    providerId,
    address: session.address,
    network: session.network.network,
    networkUrl: session.network.networkUrl,
    networkPassphrase: session.network.networkPassphrase,
    sorobanRpcUrl: session.network.sorobanRpcUrl,
    derivationPath,
    timestamp: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    localStorage.removeItem(DISCONNECT_KEY);
  } catch {
    // Storage can be unavailable (private mode); session still works in-memory.
  }
}

export function loadWalletSession(): StoredWalletSession | null {
  if (typeof window === "undefined") return null;
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data) as StoredWalletSession;
  } catch {
    return null;
  }
}

export function clearWalletSession(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

const walletProviders: Record<BrowserWalletId, WalletProvider> = {
  freighter: new FreighterWalletProvider(),
  albedo: new AlbedoWalletProvider(),
  xbull: new XBullWalletProvider(),
  lobstr: new LobstrWalletProvider(),
};

function isBrowserWallet(
  walletId: SupportedWallet,
): walletId is BrowserWalletId {
  return walletId !== "ledger";
}

export async function checkWalletAvailability(
  walletId: SupportedWallet,
): Promise<boolean> {
  if (walletId === "ledger") {
    const { detectLedgerSupport } = await import("./hardwareWallet");
    return detectLedgerSupport();
  }
  const provider = walletProviders[walletId];
  return provider?.isAvailable() ?? false;
}

export async function getAvailableWallets(): Promise<SupportedWallet[]> {
  const available: SupportedWallet[] = [];
  for (const meta of WALLET_PROVIDERS_META) {
    if (await checkWalletAvailability(meta.id)) {
      available.push(meta.id);
    }
  }
  return available;
}

export async function connectWalletWith(
  walletId: SupportedWallet,
): Promise<WalletSession> {
  if (!isBrowserWallet(walletId)) {
    throw new WalletConnectionError(
      "UNKNOWN",
      "Ledger connections must go through the hardware wallet flow.",
    );
  }

  const provider = walletProviders[walletId];
  if (!provider) {
    throw new WalletConnectionError(
      "UNKNOWN",
      `Wallet ${walletId} not supported`,
    );
  }

  const result = await provider.connect();
  const session: WalletSession = {
    address: result.address,
    network: {
      network: result.network,
      networkUrl: result.networkUrl,
      networkPassphrase: result.networkPassphrase,
      sorobanRpcUrl: result.sorobanRpcUrl,
    },
    providerId: walletId,
  };

  saveWalletSession(session, walletId);
  return session;
}

/**
 * Sign a transaction through the active browser/web wallet adapter.
 * Ledger signing is handled by WalletContext, which owns the device bridge.
 */
export async function signTransactionWith(
  walletId: BrowserWalletId,
  xdr: string,
  options: WalletSignOptions = {},
): Promise<WalletSignResult> {
  const provider = walletProviders[walletId];
  if (!provider?.signTransaction) {
    throw new WalletConnectionError(
      "UNKNOWN",
      `Wallet ${walletId} does not support transaction signing.`,
    );
  }
  return provider.signTransaction(xdr, options);
}

export async function restoreWalletSession(): Promise<WalletSession | null> {
  if (
    typeof window !== "undefined" &&
    localStorage.getItem(DISCONNECT_KEY) === "true"
  ) {
    return null;
  }

  const stored = loadWalletSession();
  if (!stored) return null;

  if (stored.providerId !== "ledger") {
    const provider = walletProviders[stored.providerId];
    if (!provider || !(await provider.isAvailable())) return null;
  }

  if (stored.networkPassphrase !== EXPECTED_NETWORK_PASSPHRASE) return null;

  return {
    address: stored.address,
    network: {
      network: stored.network,
      networkUrl: stored.networkUrl,
      networkPassphrase: stored.networkPassphrase,
      sorobanRpcUrl: stored.sorobanRpcUrl,
    },
    providerId: stored.providerId,
    derivationPath: stored.derivationPath,
  };
}

export function disconnectWallet(): void {
  clearWalletSession();
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(DISCONNECT_KEY, "true");
    } catch {
      // Ignore storage failures; in-memory state is still cleared by callers.
    }
  }
}

export function onWalletDisconnect(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener("wallet:disconnect", handler);
  return () => window.removeEventListener("wallet:disconnect", handler);
}

// Dispatch disconnect event for other tabs
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === DISCONNECT_KEY && e.newValue === "true") {
      window.dispatchEvent(new Event("wallet:disconnect"));
    }
  });
}
