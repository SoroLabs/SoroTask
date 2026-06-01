'use client';

/**
 * useMultiSigRegistration.ts
 *
 * React hook that manages the full multi-sig task registration lifecycle:
 *   - Proposal creation with validation
 *   - Approval collection with duplicate-signer protection
 *   - On-chain execution via SorobanService with live tx status
 *   - localStorage persistence across page reloads
 *
 * Must be used inside <WalletProvider>.
 */

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/app/context/WalletContext';
import { SorobanService } from '@/app/lib/soroban.service';
import {
  type ProposalDraft,
  type TaskProposal,
  addApproval,
  canExecute,
  createProposal,
  deleteProposal,
  loadProposals,
  saveProposals,
  validateDraft,
} from '@/app/lib/multisig';
import type { TransactionStatusValue } from '@/components/transaction/TransactionStatus';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UseMultiSigRegistrationReturn {
  proposals: TaskProposal[];
  /** True while a wallet signing / tx polling operation is in progress */
  submitting: boolean;
  /** Live transaction status, null when no execution is active */
  txStatus: TransactionStatusValue | null;
  /** Hash of the most recently submitted transaction */
  txHash: string | null;
  /** Human-readable error message, null when healthy */
  error: string | null;
  proposeTask: (draft: ProposalDraft) => void;
  approveProposal: (id: string) => void;
  executeProposal: (id: string) => Promise<void>;
  removeProposal: (id: string) => void;
  dismissError: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMultiSigRegistration(): UseMultiSigRegistrationReturn {
  const { session } = useWallet();

  const [proposals, setProposals] = useState<TaskProposal[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState<TransactionStatusValue | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage on mount (client-only)
  useEffect(() => {
    setProposals(loadProposals());
  }, []);

  /** Atomically updates React state and syncs to localStorage. */
  const persist = useCallback((updated: TaskProposal[]) => {
    setProposals(updated);
    saveProposals(updated);
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const proposeTask = useCallback(
    (draft: ProposalDraft) => {
      if (!session?.address) {
        setError('Connect your wallet before creating a proposal.');
        return;
      }
      const errors = validateDraft(draft);
      if (errors.length > 0) {
        setError(errors[0]);
        return;
      }
      const proposal = createProposal(draft, session.address);
      persist([proposal, ...proposals]);
    },
    [session, proposals, persist]
  );

  const approveProposal = useCallback(
    (id: string) => {
      if (!session?.address) {
        setError('Connect your wallet to approve this proposal.');
        return;
      }
      try {
        const updated = proposals.map((p) =>
          p.id === id ? addApproval(p, session.address) : p
        );
        persist(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to record approval.');
      }
    },
    [session, proposals, persist]
  );

  const executeProposal = useCallback(
    async (id: string) => {
      if (!session?.address) {
        setError('Connect your wallet to execute this proposal.');
        return;
      }
      const proposal = proposals.find((p) => p.id === id);
      if (!proposal || !canExecute(proposal)) {
        setError('Proposal is not ready for execution.');
        return;
      }

      setSubmitting(true);
      setTxStatus('confirming');
      setError(null);

      // Mark as executing immediately so the UI reflects the state
      const withExecuting = proposals.map((p) =>
        p.id === id ? { ...p, status: 'executing' as const } : p
      );
      persist(withExecuting);

      try {
        const rpcUrl =
          session.network.sorobanRpcUrl ?? 'https://rpc-futurenet.stellar.org';
        const service = new SorobanService(rpcUrl);

        const result = await service.executeContractCall({
          publicKey: session.address,
          contractId: proposal.contractAddress,
          method: proposal.functionName,
          args: [],
          networkPassphrase: session.network.networkPassphrase,
        });

        // Stellar SDK may surface the hash as txHash or hash depending on version
        const hash: string = (result as Record<string, unknown>).txHash as string
          ?? (result as Record<string, unknown>).hash as string
          ?? '';

        setTxHash(hash);
        setTxStatus('success');

        persist(
          withExecuting.map((p) =>
            p.id === id ? { ...p, status: 'executed' as const, txHash: hash } : p
          )
        );
      } catch (err) {
        setTxStatus('failed');
        setError(
          err instanceof Error ? err.message : 'On-chain execution failed unexpectedly.'
        );
        persist(
          withExecuting.map((p) =>
            p.id === id ? { ...p, status: 'failed' as const } : p
          )
        );
      } finally {
        setSubmitting(false);
      }
    },
    [session, proposals, persist]
  );

  const removeProposal = useCallback(
    (id: string) => {
      persist(deleteProposal(proposals, id));
    },
    [proposals, persist]
  );

  const dismissError = useCallback(() => setError(null), []);

  return {
    proposals,
    submitting,
    txStatus,
    txHash,
    error,
    proposeTask,
    approveProposal,
    executeProposal,
    removeProposal,
    dismissError,
  };
}
