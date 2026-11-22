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
import { FreighterWalletProvider, AlbedoWalletProvider, XBullWalletProvider, LobstrWalletProvider } from "./wallet-providers";

export type NetworkDetails = {
  network: string;
  networkUrl: string;
  networkPassphrase: string;
  sorobanRpcUrl?: string;
};

export type WalletSession = {
  address: string;
  network: NetworkDetails;
};

export type WalletError =
  | "NOT_INSTALLED"
  | "USER_REJECTED"
  | "WRONG_NETWORK"
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

/** Expected network passphrase for SoroTask (Futurenet, matching keeper config). */
export const EXPECTED_NETWORK_PASSPHRASE =
  "Test SDF Future Network ; October 2022";

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
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
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

export type SupportedWallet = "freighter" | "albedo" | "xbull" | "lobstr";

const STORAGE_KEY = "sorotask_wallet_session";
const DISCONNECT_KEY = "sorotask_wallet_disconnected";

interface StoredSession {
  providerId: SupportedWallet;
  address: string;
  networkPassphrase: string;
  network: string;
  networkUrl: string;
  sorobanRpcUrl?: string;
  timestamp: number;
}

function saveSession(session: StoredSession): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
}

function loadSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data) as StoredSession;
  } catch {
    return null;
  }
}

function clearSession(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

const walletProviders = {
  freighter: new FreighterWalletProvider(),
  albedo: new AlbedoWalletProvider(),
  xbull: new XBullWalletProvider(),
  lobstr: new LobstrWalletProvider(),
};

export async function checkWalletAvailability(walletId: SupportedWallet): Promise<boolean> {
  const provider = walletProviders[walletId];
  return provider?.isAvailable() ?? false;
}

export async function getAvailableWallets(): Promise<SupportedWallet[]> {
  const available: SupportedWallet[] = [];
  for (const [id, provider] of Object.entries(walletProviders)) {
    if (await provider.isAvailable()) {
      available.push(id as SupportedWallet);
    }
  }
  return available;
}

export async function connectWalletWith(walletId: SupportedWallet): Promise<WalletSession> {
  const provider = walletProviders[walletId];
  if (!provider) {
    throw new WalletConnectionError("UNKNOWN", `Wallet ${walletId} not supported`);
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
  };

  const stored: StoredSession = {
    providerId: walletId,
    ...session,
    timestamp: Date.now(),
  };
  saveSession(stored);
  localStorage.removeItem(DISCONNECT_KEY);

  return session;
}

export async function restoreWalletSession(): Promise<WalletSession | null> {
  if (typeof window !== "undefined" && localStorage.getItem(DISCONNECT_KEY) === "true") {
    return null;
  }

  const stored = loadSession();
  if (!stored) return null;

  const provider = walletProviders[stored.providerId];
  if (!provider || !(await provider.isAvailable())) return null;

  if (stored.networkPassphrase !== EXPECTED_NETWORK_PASSPHRASE) return null;

  return {
    address: stored.address,
    network: {
      network: stored.network,
      networkUrl: stored.networkUrl,
      networkPassphrase: stored.networkPassphrase,
      sorobanRpcUrl: stored.sorobanRpcUrl,
    },
  };
}

export function disconnectWallet(): void {
  clearSession();
  if (typeof window !== "undefined") {
    localStorage.setItem(DISCONNECT_KEY, "true");
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
