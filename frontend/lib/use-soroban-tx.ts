'use client';

import { useCallback, useReducer, useRef } from 'react';

// ─── Error Types ─────────────────────────────────────────────────────────────

/** Thrown when the user closes or rejects the wallet signing prompt. */
export class UserRejectedError extends Error {
  readonly reason = 'user_rejected' as const;
  constructor(message = 'Transaction signature was rejected.') {
    super(message);
    this.name = 'UserRejectedError';
  }
}

/** Thrown when the transaction expires or is dropped by the network. */
export class TxTimeoutError extends Error {
  readonly reason = 'timeout' as const;
  constructor(message = 'Transaction timed out or was dropped by the network.') {
    super(message);
    this.name = 'TxTimeoutError';
  }
}

/** Thrown when the transaction is accepted by the network but fails on-chain. */
export class TxOnChainError extends Error {
  readonly reason = 'transaction_failed' as const;
  constructor(message = 'Transaction was rejected during on-chain execution.') {
    super(message);
    this.name = 'TxOnChainError';
  }
}

// ─── State Types ─────────────────────────────────────────────────────────────

export type TxErrorReason =
  | 'user_rejected'      // user dismissed the wallet prompt
  | 'submission_failed'  // Horizon / network error
  | 'transaction_failed' // on-chain execution failed
  | 'timeout';           // transaction expired or dropped

export type TxState =
  | { status: 'idle' }
  | { status: 'signing' }                              // wallet prompt open
  | { status: 'submitting' }                           // XDR sent to Horizon
  | { status: 'pending'; hash: string }                // awaiting confirmation
  | { status: 'success'; hash: string }                // confirmed on-chain
  | { status: 'error'; reason: TxErrorReason; message: string };

// ─── Executor Contract ───────────────────────────────────────────────────────

/** Callbacks the executor must call at each transition boundary. */
export interface TxPhaseCallbacks {
  /** Call when the wallet prompt has been triggered. */
  onSigning: () => void;
  /** Call when the signed XDR is being submitted to the Stellar network. */
  onSubmitting: () => void;
  /** Call when Horizon has accepted the transaction and returned a hash. */
  onPending: (hash: string) => void;
}

/**
 * An async function that drives the full Soroban transaction lifecycle.
 *
 * The executor is responsible for:
 * 1. Triggering the wallet signing prompt (then calling `callbacks.onSubmitting`)
 * 2. Submitting the signed XDR to Horizon (then calling `callbacks.onPending(hash)`)
 * 3. Waiting for on-chain confirmation and returning the final hash
 *
 * Throw a typed error to communicate failure reason:
 * - `UserRejectedError`  – user dismissed the wallet
 * - `TxTimeoutError`     – tx expired / dropped
 * - `TxOnChainError`     – on-chain execution reverted
 * - Any other `Error`    – treated as `submission_failed`
 */
export type TxExecutor = (callbacks: TxPhaseCallbacks) => Promise<string>;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseSorobanTxReturn {
  state: TxState;
  /** Begin the transaction flow with the given executor. No-ops if already in flight. */
  execute: (executor: TxExecutor) => Promise<void>;
  /** Reset state back to idle. No-ops while a transaction is in flight. */
  reset: () => void;
}

function deriveErrorState(error: unknown): TxState & { status: 'error' } {
  if (error instanceof UserRejectedError) {
    return { status: 'error', reason: 'user_rejected', message: error.message };
  }
  if (error instanceof TxTimeoutError) {
    return { status: 'error', reason: 'timeout', message: error.message };
  }
  if (error instanceof TxOnChainError) {
    return { status: 'error', reason: 'transaction_failed', message: error.message };
  }
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
  return { status: 'error', reason: 'submission_failed', message };
}

/**
 * Manages the full Soroban transaction UX state machine:
 * idle → signing → submitting → pending → success | error
 *
 * Prevents double-execution; ignores reset() while a transaction is in flight
 * so the UI remains stable if the user switches tabs or dismisses dialogs.
 */
export function useSorobanTx(): UseSorobanTxReturn {
  const [state, setState] = useReducer(
    (_prev: TxState, next: TxState): TxState => next,
    { status: 'idle' } as TxState,
  );

  // Prevents concurrent executions without causing re-renders.
  const inFlightRef = useRef(false);

  const execute = useCallback(async (executor: TxExecutor): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setState({ status: 'signing' });

    const callbacks: TxPhaseCallbacks = {
      onSigning: () => setState({ status: 'signing' }),
      onSubmitting: () => setState({ status: 'submitting' }),
      onPending: (hash: string) => setState({ status: 'pending', hash }),
    };

    try {
      const hash = await executor(callbacks);
      setState({ status: 'success', hash });
    } catch (err) {
      setState(deriveErrorState(err));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    if (inFlightRef.current) return;
    setState({ status: 'idle' });
  }, []);

  return { state, execute, reset };
}
