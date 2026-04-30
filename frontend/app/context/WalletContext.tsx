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
} from "react";

import {
  connectWallet,
  restoreSession,
  watchWalletChanges,
  WalletConnectionError,
  type WalletSession,
  type WalletError,
} from "@/app/lib/wallet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  | "idle"       // initial state, not yet checked
  | "restoring"  // silently re-hydrating session on mount
  | "connecting" // user clicked Connect, waiting for Freighter popup
  | "connected"  // wallet is connected and session is valid
  | "disconnected" // explicitly disconnected or session lost
  | "error";     // connection attempt failed

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
  /** Trigger wallet connection (shows Freighter popup) */
  connect: () => Promise<void>;
  /** Clear session state */
  disconnect: () => void;
  /** Clear the current error */
  clearError: () => void;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WalletContext = createContext<WalletContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [session, setSession] = useState<WalletSession | null>(null);
  const [errorCode, setErrorCode] = useState<WalletError | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLoading = status === "restoring" || status === "connecting";

  // Keep a ref to the watcher cleanup so we can stop it on unmount or disconnect
  const stopWatcherRef = useRef<(() => void) | null>(null);

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
    let cancelled = false;

    async function restore() {
      setStatus("restoring");
      const existing = await restoreSession();
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
  }, [startWatcher]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const connect = useCallback(async () => {
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

  const disconnect = useCallback(() => {
    stopWatcherRef.current?.();
    stopWatcherRef.current = null;
    setSession(null);
    setErrorCode(null);
    setErrorMessage(null);
    setStatus("disconnected");
  }, []);

  const clearError = useCallback(() => {
    setErrorCode(null);
    setErrorMessage(null);
    setStatus("disconnected");
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
        connect,
        disconnect,
        clearError,
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
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside <WalletProvider>.");
  }
  return ctx;
}
