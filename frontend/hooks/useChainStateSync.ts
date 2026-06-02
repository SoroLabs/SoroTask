/**
 * useChainStateSync.ts - React hook for chain state synchronization with reorg handling
 * 
 * Provides a robust synchronization engine that keeps frontend state in sync with
 * the Soroban blockchain, handling chain reorganizations, dropped transactions,
 * and network disruptions gracefully.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { SorobanRpc } from '@stellar/stellar-sdk';

export interface ChainState {
  ledgerSequence: number;
  ledgerTimestamp: number;
  networkPassphrase: string;
  isSyncing: boolean;
  lastSyncTime: number;
  reorgDepth: number;
}

export interface TransactionState {
  hash: string;
  status: 'pending' | 'success' | 'failed' | 'dropped';
  ledgerSequence?: number;
  timestamp?: number;
  error?: string;
  reorgDetected?: boolean;
}

export interface ChainSyncConfig {
  rpcUrl: string;
  networkPassphrase: string;
  syncInterval?: number;
  reorgThreshold?: number;
  maxReorgDepth?: number;
  enableAutoRecovery?: boolean;
}

export interface ChainSyncResult {
  state: ChainState;
  transactions: Map<string, TransactionState>;
  sync: () => Promise<void>;
  forceSync: () => Promise<void>;
  addTransaction: (hash: string) => void;
  removeTransaction: (hash: string) => void;
  getTransaction: (hash: string) => TransactionState | undefined;
  isHealthy: boolean;
  error: string | null;
}

/**
 * Chain State Sync Hook
 * 
 * Manages synchronization between frontend state and Soroban blockchain,
 * with automatic reorg detection and recovery.
 */
export function useChainStateSync(config: ChainSyncConfig): ChainSyncResult {
  const {
    rpcUrl,
    networkPassphrase,
    syncInterval = 5000,
    reorgThreshold = 10,
    maxReorgDepth = 100,
    enableAutoRecovery = true,
  } = config;

  const [state, setState] = useState<ChainState>({
    ledgerSequence: 0,
    ledgerTimestamp: 0,
    networkPassphrase,
    isSyncing: false,
    lastSyncTime: 0,
    reorgDepth: 0,
  });

  const [transactions, setTransactions] = useState<Map<string, TransactionState>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isHealthy, setIsHealthy] = useState(true);

  const rpcRef = useRef<SorobanRpc.Server | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastLedgerSequenceRef = useRef<number>(0);
  const pendingTransactionsRef = useRef<Set<string>>(new Set());

  // Initialize RPC client
  useEffect(() => {
    try {
      rpcRef.current = new SorobanRpc.Server(rpcUrl);
    } catch (err) {
      setError(`Failed to initialize RPC: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsHealthy(false);
    }

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [rpcUrl]);

  // Sync function
  const sync = useCallback(async () => {
    if (!rpcRef.current || state.isSyncing) return;

    setState(prev => ({ ...prev, isSyncing: true }));
    setError(null);

    try {
      const ledger = await rpcRef.current.getLatestLedger();
      const currentSequence = Number(ledger.sequence);
      const currentTimestamp = Number(ledger.timestamp);

      // Detect reorg
      const reorgDepth = calculateReorgDepth(
        lastLedgerSequenceRef.current,
        currentSequence
      );

      if (reorgDepth > reorgThreshold) {
        console.warn(`Reorg detected: depth ${reorgDepth}`);
        setState(prev => ({ ...prev, reorgDepth }));
        
        if (reorgDepth > maxReorgDepth) {
          setError(`Reorg depth ${reorgDepth} exceeds maximum ${maxReorgDepth}`);
          setIsHealthy(false);
          
          if (enableAutoRecovery) {
            await handleReorg(reorgDepth);
          }
        }
      }

      // Update transaction states
      await updateTransactionStates(currentSequence);

      setState({
        ledgerSequence: currentSequence,
        ledgerTimestamp: currentTimestamp,
        networkPassphrase,
        isSyncing: false,
        lastSyncTime: Date.now(),
        reorgDepth,
      });

      lastLedgerSequenceRef.current = currentSequence;
      setIsHealthy(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sync failed';
      setError(errorMessage);
      setIsHealthy(false);
      setState(prev => ({ ...prev, isSyncing: false }));
    }
  }, [state.isSyncing, reorgThreshold, maxReorgDepth, enableAutoRecovery, networkPassphrase]);

  // Force sync (immediate, bypasses interval)
  const forceSync = useCallback(async () => {
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
    }
    await sync();
    startSyncInterval();
  }, [sync]);

  // Start sync interval
  const startSyncInterval = useCallback(() => {
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
    }
    syncIntervalRef.current = setInterval(sync, syncInterval);
  }, [sync, syncInterval]);

  // Start sync on mount
  useEffect(() => {
    startSyncInterval();
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [startSyncInterval]);

  // Calculate reorg depth
  const calculateReorgDepth = (lastSequence: number, currentSequence: number): number => {
    if (lastSequence === 0) return 0;
    if (currentSequence > lastSequence) return 0;
    return lastSequence - currentSequence;
  };

  // Handle reorg recovery
  const handleReorg = async (depth: number): Promise<void> => {
    console.log(`Initiating reorg recovery for depth ${depth}`);
    
    // Mark transactions as potentially dropped
    setTransactions(prev => {
      const updated = new Map(prev);
      for (const [hash, tx] of updated.entries()) {
        if (tx.status === 'success' && tx.ledgerSequence) {
          const txLedger = tx.ledgerSequence;
          const currentLedger = state.ledgerSequence;
          
          // If transaction was in the reorged block range, mark as dropped
          if (txLedger > currentLedger - depth) {
            updated.set(hash, {
              ...tx,
              status: 'dropped',
              reorgDetected: true,
            });
          }
        }
      }
      return updated;
    });
  };

  // Update transaction states
  const updateTransactionStates = async (currentLedger: number): Promise<void> => {
    if (!rpcRef.current) return;

    const updates = new Map<string, TransactionState>();

    for (const [hash, tx] of transactions.entries()) {
      if (tx.status === 'pending') {
        try {
          const response = await rpcRef.current.getTransaction(hash);
          
          if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
            updates.set(hash, {
              ...tx,
              status: 'success',
              ledgerSequence: currentLedger,
              timestamp: Date.now(),
            });
          } else if (response.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
            updates.set(hash, {
              ...tx,
              status: 'failed',
              error: 'Transaction failed on-chain',
              timestamp: Date.now(),
            });
          }
          // NOT_FOUND means still pending
        } catch (err) {
          // Transaction might be dropped due to reorg
          if (tx.ledgerSequence && tx.ledgerSequence > currentLedger - reorgThreshold) {
            updates.set(hash, {
              ...tx,
              status: 'dropped',
              reorgDetected: true,
              error: 'Transaction dropped during reorg',
            });
          }
        }
      }
    }

    if (updates.size > 0) {
      setTransactions(prev => {
        const updated = new Map(prev);
        for (const [hash, tx] of updates.entries()) {
          updated.set(hash, tx);
        }
        return updated;
      });
    }
  };

  // Add transaction to track
  const addTransaction = useCallback((hash: string) => {
    setTransactions(prev => {
      const updated = new Map(prev);
      updated.set(hash, {
        hash,
        status: 'pending',
        timestamp: Date.now(),
      });
      return updated;
    });
    pendingTransactionsRef.current.add(hash);
  }, []);

  // Remove transaction from tracking
  const removeTransaction = useCallback((hash: string) => {
    setTransactions(prev => {
      const updated = new Map(prev);
      updated.delete(hash);
      return updated;
    });
    pendingTransactionsRef.current.delete(hash);
  }, []);

  // Get transaction state
  const getTransaction = useCallback((hash: string): TransactionState | undefined => {
    return transactions.get(hash);
  }, [transactions]);

  return {
    state,
    transactions,
    sync,
    forceSync,
    addTransaction,
    removeTransaction,
    getTransaction,
    isHealthy,
    error,
  };
}

/**
 * Hook for monitoring a specific transaction
 */
export function useTransactionMonitor(
  hash: string,
  chainSync: ChainSyncResult
): TransactionState | undefined {
  const [txState, setTxState] = useState<TransactionState | undefined>(
    chainSync.getTransaction(hash)
  );

  useEffect(() => {
    setTxState(chainSync.getTransaction(hash));
  }, [hash, chainSync]);

  return txState;
}

/**
 * Hook for detecting reorgs
 */
export function useReorgDetector(chainSync: ChainSyncResult): {
  hasReorg: boolean;
  reorgDepth: number;
  isRecovering: boolean;
} {
  const [hasReorg, setHasReorg] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    const reorgDepth = chainSync.state.reorgDepth;
    setHasReorg(reorgDepth > 0);
    setIsRecovering(reorgDepth > 10 && chainSync.state.isSyncing);
  }, [chainSync.state.reorgDepth, chainSync.state.isSyncing]);

  return {
    hasReorg,
    reorgDepth: chainSync.state.reorgDepth,
    isRecovering,
  };
}
