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

/**
 * Returns true if the Freighter extension is installed in the browser.
 * Safe to call on the server — returns false when window is undefined.
 */
export async function isFreighterInstalled(): Promise<boolean> {
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
  const networkResult = await getNetworkDetails();
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

/**
 * Silently re-hydrates the session if the user has already authorised the app.
 * Returns null if Freighter is not installed, not allowed, or returns no address.
 * Never throws — safe to call on mount.
 */
export async function restoreSession(): Promise<WalletSession | null> {
  if (typeof window === "undefined") return null;
  try {
    const allowed = await isAppAllowed();
    if (!allowed) return null;

    const addressResult = await getAddress();
    if (addressResult.error || !addressResult.address) return null;

    const networkResult = await getNetworkDetails();
    if (networkResult.error) return null;

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
  const watcher = new WatchWalletChanges(pollMs);

  watcher.watch(({ address, network, networkPassphrase }) => {
    if (!address) {
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
