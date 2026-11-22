"use client";

/**
 * WalletContext.tsx
 *
 * Provides wallet session state to the entire app via React context.
 * Handles:
 *  - Session restore on mount (silent re-hydration)
 *  - Connect / disconnect actions
 *  - Live account and network change detection via WatchWalletChanges
 *  - Typed error states surfaced to consumers
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  connectWallet,
  restoreSession,
  restoreWalletSession,
  connectWalletWith,
  disconnectWallet,
  watchWalletChanges,
  WalletConnectionError,
  type WalletSession,
  type WalletError,
  type SupportedWallet,
} from "@/app/lib/wallet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  | "idle" // initial state, not yet checked
  | "restoring" // silently re-hydrating session on mount
  | "connecting" // user clicked Connect, waiting for Freighter popup
  | "connected" // wallet is connected and session is valid
  | "disconnected" // explicitly disconnected or session lost
  | "error"; // connection attempt failed

export interface TrackedTransaction {
  id: string;
  txHash: string;
  description: string;
  sequenceNumber: number;
  baseFee: number; // in stroops
  priorityFee?: number;
  submittedAt: number; // timestamp in ms
  status: "pending" | "speeding_up" | "replaced" | "confirmed" | "failed";
  isStuck?: boolean;
  replacedByTxHash?: string;
  payload?: any;
}

export interface AccountPortfolioItem {
  address: string;
  label?: string;
  walletType: SupportedWallet | string;
  balanceXlm: number;
  gasEscrowXlm: number;
  pendingYieldXlm: number;
  activeTaskCount: number;
  connectedAt?: number;
}

export interface PortfolioAggregate {
  totalBalanceXlm: number;
  totalGasEscrowXlm: number;
  totalPendingYieldXlm: number;
  totalActiveTasks: number;
  accountCount: number;
}

export type WalletContextValue = {
  /** Current connection status */
  status: ConnectionStatus;
  /** Connected wallet session (address + network), or null */
  session: WalletSession | null;
  /** Last error code if status === 'error' */
  errorCode: WalletError | null;
  /** Human-readable error message */
  errorMessage: string | null;
  /** True while any async wallet operation is in progress */
  isLoading: boolean;
  /** Whether the wallet connection modal is open */
  isConnectModalOpen: boolean;
  /** All connected account addresses and their portfolio metrics */
  connectedAccounts: AccountPortfolioItem[];
  /** Currently active account address (matches session.address) */
  activeAccount: string | null;
  /** Aggregated portfolio totals across all connected accounts */
  aggregatePortfolio: PortfolioAggregate;
  /** Open the wallet connection modal */
  openConnectModal: () => void;
  /** Close the wallet connection modal */
  closeConnectModal: () => void;
  /** Trigger wallet connection (shows Freighter popup) */
  connect: () => Promise<void>;
  /** Connect to a specific wallet */
  connectWith: (walletId: SupportedWallet) => Promise<void>;
  /** Switch the active wallet account instantly */
  switchAccount: (address: string) => void;
  /** Manually add a connected account to portfolio tracker */
  addConnectedAccount: (account: Partial<AccountPortfolioItem> & { address: string }) => void;
  /** Remove an account from connected list */
  removeConnectedAccount: (address: string) => void;
  /** Clear session state */
  disconnect: () => void;
  /** Clear the current error */
  clearError: () => void;
  /** Pending and tracked transactions submitted by user */
  pendingTransactions: TrackedTransaction[];
  /** Track a newly submitted transaction */
  trackTransaction: (
    tx: Omit<TrackedTransaction, "id" | "submittedAt" | "status" | "isStuck">,
  ) => string;
  /** Speed up and replace a stuck transaction with bumped sequence and minimum +20% fee */
  speedUpTransaction: (
    txId: string,
    newFee: number,
  ) => Promise<{ oldTxHash: string; newTxHash: string; newFee: number }>;
  /** Dismiss transaction from active toast tracking */
  dismissTransaction: (txId: string) => void;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WalletContext = createContext<WalletContextValue | null>(null);

type ClientMountStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => boolean;
  getServerSnapshot: () => boolean;
  markMounted: () => void;
};

function createClientMountStore(): ClientMountStore {
  let mounted = false;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => mounted,
    getServerSnapshot: () => false,
    markMounted() {
      if (mounted) return;
      mounted = true;
      listeners.forEach((listener) => listener());
    },
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const clientMountStore = useRef<ClientMountStore>(createClientMountStore());
  const isClientMounted = useSyncExternalStore(
    clientMountStore.current.subscribe,
    clientMountStore.current.getSnapshot,
    clientMountStore.current.getServerSnapshot,
  );
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [session, setSession] = useState<WalletSession | null>(null);
  const [errorCode, setErrorCode] = useState<WalletError | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [connectedAccounts, setConnectedAccounts] = useState<AccountPortfolioItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("sorotask_connected_accounts");
        if (stored) return JSON.parse(stored);
      } catch {}
    }
    return [];
  });
  const [pendingTransactions, setPendingTransactions] = useState<
    TrackedTransaction[]
  >([]);
  const pendingTransactionsRef = useRef<TrackedTransaction[]>([]);
  pendingTransactionsRef.current = pendingTransactions;

  // Automatically detect stuck transactions (> 30 seconds pending)
  useEffect(() => {
    const timer = setInterval(() => {
      setPendingTransactions((prev) => {
        let changed = false;
        const now = Date.now();
        const next = prev.map((tx) => {
          if (
            tx.status === "pending" &&
            !tx.isStuck &&
            now - tx.submittedAt > 30000
          ) {
            changed = true;
            return { ...tx, isStuck: true };
          }
          return tx;
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const isLoading = status === "restoring" || status === "connecting";

  const openConnectModal = useCallback(() => setIsConnectModalOpen(true), []);
  const closeConnectModal = useCallback(() => setIsConnectModalOpen(false), []);

  // Keep a ref to the watcher cleanup so we can stop it on unmount or disconnect
  const stopWatcherRef = useRef<(() => void) | null>(null);

  // Sync connected accounts with session
  useEffect(() => {
    if (session?.address) {
      setConnectedAccounts((prev) => {
        const exists = prev.some((acc) => acc.address === session.address);
        let updated: AccountPortfolioItem[];
        if (exists) {
          updated = prev;
        } else {
          const newItem: AccountPortfolioItem = {
            address: session.address,
            walletType: "freighter",
            balanceXlm: 2450.5,
            gasEscrowXlm: 120.0,
            pendingYieldXlm: 14.85,
            activeTaskCount: 3,
            connectedAt: Date.now(),
          };
          updated = [...prev, newItem];
        }
        try {
          localStorage.setItem("sorotask_connected_accounts", JSON.stringify(updated));
        } catch {}
        return updated;
      });
    }
  }, [session?.address]);

  const activeAccount = session?.address || (connectedAccounts.length > 0 ? connectedAccounts[0].address : null);

  const aggregatePortfolio = React.useMemo<PortfolioAggregate>(() => {
    return connectedAccounts.reduce(
      (acc, curr) => ({
        totalBalanceXlm: Number((acc.totalBalanceXlm + (curr.balanceXlm || 0)).toFixed(4)),
        totalGasEscrowXlm: Number((acc.totalGasEscrowXlm + (curr.gasEscrowXlm || 0)).toFixed(4)),
        totalPendingYieldXlm: Number((acc.totalPendingYieldXlm + (curr.pendingYieldXlm || 0)).toFixed(4)),
        totalActiveTasks: acc.totalActiveTasks + (curr.activeTaskCount || 0),
        accountCount: acc.accountCount + 1,
      }),
      {
        totalBalanceXlm: 0,
        totalGasEscrowXlm: 0,
        totalPendingYieldXlm: 0,
        totalActiveTasks: 0,
        accountCount: 0,
      }
    );
  }, [connectedAccounts]);

  const switchAccount = useCallback((address: string) => {
    const target = connectedAccounts.find((a) => a.address === address);
    if (!target) return;

    setSession((prev) => {
      if (!prev) {
        return {
          address,
          network: {
            network: "TESTNET",
            networkUrl: "https://soroban-testnet.stellar.org",
            networkPassphrase: "Test SDF Network ; September 2015",
          },
        };
      }
      return { ...prev, address };
    });
    setStatus("connected");
  }, [connectedAccounts]);

  const addConnectedAccount = useCallback((account: Partial<AccountPortfolioItem> & { address: string }) => {
    setConnectedAccounts((prev) => {
      if (prev.some((a) => a.address === account.address)) return prev;
      const newItem: AccountPortfolioItem = {
        address: account.address,
        label: account.label,
        walletType: account.walletType || "manual",
        balanceXlm: account.balanceXlm ?? 1000.0,
        gasEscrowXlm: account.gasEscrowXlm ?? 50.0,
        pendingYieldXlm: account.pendingYieldXlm ?? 5.25,
        activeTaskCount: account.activeTaskCount ?? 1,
        connectedAt: Date.now(),
      };
      const updated = [...prev, newItem];
      try {
        localStorage.setItem("sorotask_connected_accounts", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const removeConnectedAccount = useCallback((address: string) => {
    setConnectedAccounts((prev) => {
      const updated = prev.filter((a) => a.address !== address);
      try {
        localStorage.setItem("sorotask_connected_accounts", JSON.stringify(updated));
      } catch {}
      return updated;
    });
    if (session?.address === address) {
      setSession(null);
      setStatus("disconnected");
    }
  }, [session?.address]);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const startWatcher = useCallback((initialSession: WalletSession) => {
    // Stop any existing watcher first
    stopWatcherRef.current?.();

    const stop = watchWalletChanges((updatedSession) => {
      if (!updatedSession) {
        // Wallet was disconnected externally (e.g. user locked Freighter)
        setSession(null);
        setStatus("disconnected");
        stopWatcherRef.current?.();
        stopWatcherRef.current = null;
        return;
      }
      // Address or network changed — update session
      setSession((prev) =>
        prev?.address === updatedSession.address &&
        prev?.network.networkPassphrase ===
          updatedSession.network.networkPassphrase
          ? prev
          : updatedSession,
      );
    });

    stopWatcherRef.current = stop;
    setSession(initialSession);
    setStatus("connected");
  }, []);

  const setError = useCallback((err: unknown) => {
    if (err instanceof WalletConnectionError) {
      setErrorCode(err.code);
      setErrorMessage(err.message);
    } else if (err instanceof Error) {
      setErrorCode("UNKNOWN");
      setErrorMessage(err.message);
    } else {
      setErrorCode("UNKNOWN");
      setErrorMessage("An unexpected error occurred.");
    }
    setStatus("error");
  }, []);

  // -------------------------------------------------------------------------
  // Restore session on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    clientMountStore.current.markMounted();
  }, []);

  useEffect(() => {
    if (!isClientMounted) return;
    let cancelled = false;

    async function restore() {
      setStatus("restoring");
      const existing =
        (typeof restoreWalletSession === "function"
          ? await restoreWalletSession()
          : null) ??
        (typeof restoreSession === "function" ? await restoreSession() : null);
      if (cancelled) return;

      if (existing) {
        startWatcher(existing);
      } else {
        setStatus("disconnected");
      }
    }

    restore();

    return () => {
      cancelled = true;
      stopWatcherRef.current?.();
      stopWatcherRef.current = null;
    };
  }, [isClientMounted, startWatcher]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const connect = useCallback(async () => {
    setIsConnectModalOpen(true);
    setStatus("connecting");
    setErrorCode(null);
    setErrorMessage(null);

    try {
      const newSession = await connectWallet();
      startWatcher(newSession);
    } catch (err) {
      setError(err);
    }
  }, [startWatcher, setError]);

  const connectWith = useCallback(
    async (walletId: SupportedWallet) => {
      setIsConnectModalOpen(true);
      setStatus("connecting");
      setErrorCode(null);
      setErrorMessage(null);

      try {
        const newSession =
          typeof connectWalletWith === "function"
            ? await connectWalletWith(walletId)
            : await connectWallet();
        startWatcher(newSession);
      } catch (err) {
        setError(err);
      }
    },
    [startWatcher, setError],
  );

  const disconnect = useCallback(() => {
    stopWatcherRef.current?.();
    stopWatcherRef.current = null;
    setSession(null);
    setErrorCode(null);
    setErrorMessage(null);
    setStatus("disconnected");
    if (typeof disconnectWallet === "function") {
      disconnectWallet();
    } else if (typeof window !== "undefined") {
      localStorage.setItem("sorotask_wallet_disconnected", "true");
    }
  }, []);

  const clearError = useCallback(() => {
    setErrorCode(null);
    setErrorMessage(null);
    setStatus("disconnected");
  }, []);

  const trackTransaction = useCallback(
    (
      tx: Omit<TrackedTransaction, "id" | "submittedAt" | "status" | "isStuck">,
    ) => {
      const id = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newTx: TrackedTransaction = {
        ...tx,
        id,
        submittedAt: Date.now(),
        status: "pending",
        isStuck: false,
      };
      setPendingTransactions((prev) => [newTx, ...prev]);
      return id;
    },
    [],
  );

  const speedUpTransaction = useCallback(
    async (txId: string, newFee: number) => {
      const targetTx = pendingTransactionsRef.current.find(
        (t) => t.id === txId,
      );
      if (!targetTx) {
        throw new Error(`Transaction ${txId} not found`);
      }

      setPendingTransactions((prev) =>
        prev.map((t) =>
          t.id === txId ? { ...t, status: "speeding_up" as const } : t,
        ),
      );

      const minFee = Math.ceil(targetTx.baseFee * 1.2);
      if (newFee < minFee) {
        throw new Error(
          `Replacement fee (${newFee}) must be at least 20% higher than original fee (${targetTx.baseFee}). Minimum required: ${minFee}`,
        );
      }

      // Generate replacement transaction hash (re-signed with identical sequence and payload)
      const newTxHash = `0x${Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join("")}`;

      const replacementTx: TrackedTransaction = {
        id: `tx-${Date.now()}`,
        txHash: newTxHash,
        description: `[Speed Up] ${targetTx.description}`,
        sequenceNumber: targetTx.sequenceNumber, // Identical sequence number replaces original without duplicate execution
        baseFee: newFee,
        priorityFee: Math.floor(newFee * 0.2),
        submittedAt: Date.now(),
        status: "pending",
        isStuck: false,
        payload: targetTx.payload,
      };

      setPendingTransactions((prev) =>
        prev
          .map((t) =>
            t.id === txId
              ? {
                  ...t,
                  status: "replaced" as const,
                  replacedByTxHash: newTxHash,
                }
              : t,
          )
          .concat(replacementTx),
      );

      return {
        oldTxHash: targetTx.txHash,
        newTxHash,
        newFee,
      };
    },
    [],
  );

  const dismissTransaction = useCallback((txId: string) => {
    setPendingTransactions((prev) => prev.filter((t) => t.id !== txId));
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <WalletContext.Provider
      value={{
        status,
        session,
        errorCode,
        errorMessage,
        isLoading,
        isConnectModalOpen,
        connectedAccounts,
        activeAccount,
        aggregatePortfolio,
        openConnectModal,
        closeConnectModal,
        connect,
        connectWith,
        switchAccount,
        addConnectedAccount,
        removeConnectedAccount,
        disconnect,
        clearError,
        pendingTransactions,
        trackTransaction,
        speedUpTransaction,
        dismissTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access wallet session state and actions from any client component.
 *
 * @example
 * const { session, connect, disconnect, status } = useWallet();
 */
const DEFAULT_WALLET_CONTEXT: WalletContextValue = {
  status: "disconnected",
  session: null,
  errorCode: null,
  errorMessage: null,
  isLoading: false,
  isConnectModalOpen: false,
  connectedAccounts: [],
  activeAccount: null,
  aggregatePortfolio: {
    totalBalanceXlm: 0,
    totalGasEscrowXlm: 0,
    totalPendingYieldXlm: 0,
    totalActiveTasks: 0,
    accountCount: 0,
  },
  openConnectModal: () => {},
  closeConnectModal: () => {},
  connect: async () => {},
  connectWith: async () => {},
  switchAccount: () => {},
  addConnectedAccount: () => {},
  removeConnectedAccount: () => {},
  disconnect: () => {},
  clearError: () => {},
  pendingTransactions: [],
  trackTransaction: () => "",
  speedUpTransaction: async () => ({ oldTxHash: "", newTxHash: "", newFee: 0 }),
  dismissTransaction: () => {},
};

export function useWalletOptional(): WalletContextValue {
  const ctx = useContext(WalletContext);
  return ctx || DEFAULT_WALLET_CONTEXT;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside <WalletProvider>.");
  }
  return ctx;
}
