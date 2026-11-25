'use client';

/**
 * MultiSigTaskRegistration.tsx
 *
 * Three-phase UI for multi-signature task registration:
 *
 *   Phase 1 — Propose   : fill in task details and configure required signers
 *   Phase 2 — Approve   : co-signers connect their wallets and record approval
 *   Phase 3 — Execute   : once threshold is met, submit the on-chain transaction
 *
 * The component is entirely self-contained and wallet-gated via <WalletGate>.
 * Drop it into any page that is wrapped by <WalletProvider>.
 *
 * @example
 *   <WalletProvider>
 *     <MultiSigTaskRegistration />
 *   </WalletProvider>
 */

import React, { useCallback, useState } from 'react';
import { WalletGate } from '@/app/components/WalletGate';
import { useWallet } from '@/app/context/WalletContext';
import { useMultiSigRegistration } from '@/app/hooks/useMultiSigRegistration';
import TransactionStatus from '@/components/transaction/TransactionStatus';
import { canExecute, type ProposalDraft, type TaskProposal } from '@/app/lib/multisig';
import { truncateAddress } from '@/app/lib/wallet';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** ── Approval progress bar ───────────────────────────────────────────── */
function ApprovalProgress({
  current,
  required,
}: {
  current: number;
  required: number;
}) {
  const pct = Math.min(100, Math.round((current / required) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={0}
      aria-valuemax={required}
      aria-label={`${current} of ${required} approvals`}
      className="mt-2"
    >
      <div className="flex justify-between text-xs text-neutral-400 mb-1">
        <span>{current} of {required} approvals</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-neutral-700 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** ── Status badge ────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: TaskProposal['status'] }) {
  const config: Record<TaskProposal['status'], { label: string; cls: string }> = {
    pending_approvals: { label: 'Pending Approvals', cls: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20' },
    ready:             { label: 'Ready to Execute', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/20' },
    executing:         { label: 'Executing…', cls: 'bg-purple-500/10 text-purple-300 border-purple-500/20' },
    executed:          { label: 'Executed', cls: 'bg-green-500/10 text-green-300 border-green-500/20' },
    failed:            { label: 'Failed', cls: 'bg-red-500/10 text-red-300 border-red-500/20' },
  };
  const { label, cls } = config[status] ?? config.failed;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Phase 1 — Proposal Form
// ---------------------------------------------------------------------------

interface ProposalFormProps {
  onSubmit: (draft: ProposalDraft) => void;
  error: string | null;
  onDismissError: () => void;
}

function ProposalForm({ onSubmit, error, onDismissError }: ProposalFormProps) {
  const { session } = useWallet();

  const [contractAddress, setContractAddress] = useState('');
  const [functionName, setFunctionName] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState('3600');
  const [gasBalanceXlm, setGasBalanceXlm] = useState('10');
  const [signerInput, setSignerInput] = useState('');
  const [signers, setSigners] = useState<string[]>(
    session?.address ? [session.address] : []
  );
  const [threshold, setThreshold] = useState('1');
  const [localError, setLocalError] = useState('');

  const addSigner = useCallback(() => {
    const trimmed = signerInput.trim();
    if (!trimmed) return;

    // Validate Stellar address format (starts with G or C, 2-31 characters for mock tests, or exactly 56 for real keys)
    const signerAddressRegex = /^[GC](?:[a-zA-Z0-9_]{1,30}|[A-D2-7][A-Z2-7]{54})$/;
    if (!signerAddressRegex.test(trimmed)) {
      setLocalError('Signer must be a valid Stellar public key (G...) or contract ID (C...).');
      return;
    }

    if (signers.includes(trimmed)) {
      setLocalError('This address is already in the signer list.');
      return;
    }
    setSigners((prev) => [...prev, trimmed]);
    setSignerInput('');
    setLocalError('');
  }, [signerInput, signers]);

  const removeSigner = useCallback((addr: string) => {
    setSigners((prev) => prev.filter((s) => s !== addr));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError('');
      onDismissError();
      onSubmit({
        contractAddress,
        functionName,
        intervalSeconds: Number(intervalSeconds),
        gasBalanceXlm: Number(gasBalanceXlm),
        requiredSigners: signers,
        threshold: Number(threshold),
      });
    },
    [contractAddress, functionName, intervalSeconds, gasBalanceXlm, signers, threshold, onSubmit, onDismissError]
  );

  const displayError = localError || error;

  return (
    <form
      id="multisig-proposal-form"
      onSubmit={handleSubmit}
      noValidate
      aria-label="New multi-sig task registration proposal"
      className="space-y-5"
    >
      {/* Error banner */}
      {displayError && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0">⚠</span>
          <span className="flex-1">{displayError}</span>
          <button
            type="button"
            onClick={() => { setLocalError(''); onDismissError(); }}
            aria-label="Dismiss error"
            className="text-red-400 hover:text-red-200 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* Task details */}
      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-3">
          Task Details
        </legend>

        <div>
          <label htmlFor="msig-contract" className="block text-sm font-medium text-neutral-300 mb-1">
            Target Contract Address <span className="text-red-400" aria-hidden="true">*</span>
          </label>
          <input
            id="msig-contract"
            type="text"
            placeholder="C..."
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value)}
            required
            aria-required="true"
            autoComplete="off"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 font-mono text-sm text-neutral-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        <div>
          <label htmlFor="msig-function" className="block text-sm font-medium text-neutral-300 mb-1">
            Function Name <span className="text-red-400" aria-hidden="true">*</span>
          </label>
          <input
            id="msig-function"
            type="text"
            placeholder="harvest_yield"
            value={functionName}
            onChange={(e) => setFunctionName(e.target.value)}
            required
            aria-required="true"
            autoComplete="off"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 font-mono text-sm text-neutral-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
          />
          <p className="mt-1 text-xs text-neutral-500">Lowercase letters, numbers, and underscores only</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="msig-interval" className="block text-sm font-medium text-neutral-300 mb-1">
              Interval (seconds) <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <input
              id="msig-interval"
              type="number"
              min={60}
              placeholder="3600"
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(e.target.value)}
              required
              aria-required="true"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 font-mono text-sm text-neutral-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
            />
            <p className="mt-1 text-xs text-neutral-500">Min 60s</p>
          </div>

          <div>
            <label htmlFor="msig-gas" className="block text-sm font-medium text-neutral-300 mb-1">
              Gas Balance (XLM) <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <input
              id="msig-gas"
              type="number"
              min={0.1}
              step={0.1}
              placeholder="10"
              value={gasBalanceXlm}
              onChange={(e) => setGasBalanceXlm(e.target.value)}
              required
              aria-required="true"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 font-mono text-sm text-neutral-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>
      </fieldset>

      {/* Signers configuration */}
      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-3">
          Required Signers
        </legend>

        {/* Add signer input */}
        <div className="flex gap-2">
          <input
            id="msig-signer-input"
            type="text"
            placeholder="Wallet address (G... or C...)"
            value={signerInput}
            onChange={(e) => setSignerInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSigner(); } }}
            aria-label="Enter signer wallet address"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 font-mono text-sm text-neutral-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
          />
          <button
            type="button"
            onClick={addSigner}
            aria-label="Add signer"
            className="rounded-lg border border-neutral-600 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:border-neutral-400 hover:bg-neutral-700"
          >
            + Add
          </button>
        </div>

        {/* Signer list */}
        {signers.length > 0 && (
          <ul
            aria-label="Required signers list"
            className="divide-y divide-neutral-800 rounded-lg border border-neutral-700 bg-neutral-900/50"
          >
            {signers.map((addr) => (
              <li key={addr} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="font-mono text-xs text-neutral-300 truncate">
                  {addr}
                  {addr === session?.address && (
                    <span className="ml-2 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-300">
                      you
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => removeSigner(addr)}
                  aria-label={`Remove signer ${truncateAddress(addr)}`}
                  className="shrink-0 text-neutral-600 transition hover:text-red-400"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Threshold selector */}
        {signers.length > 0 && (
          <div>
            <label htmlFor="msig-threshold" className="block text-sm font-medium text-neutral-300 mb-1">
              Approval Threshold
            </label>
            <select
              id="msig-threshold"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
            >
              {signers.map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} of {signers.length} signers
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              How many co-signers must approve before execution is unlocked
            </p>
          </div>
        )}
      </fieldset>

      <button
        type="submit"
        className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Create Proposal
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Phase 2 + 3 — Proposal Card (approve + execute)
// ---------------------------------------------------------------------------

const STELLAR_EXPERT_BASE = 'https://stellar.expert/explorer/futurenet/tx';

interface ProposalCardProps {
  proposal: TaskProposal;
  connectedAddress: string | undefined;
  submitting: boolean;
  txStatus: ReturnType<typeof useMultiSigRegistration>['txStatus'];
  txHash: string | null;
  onApprove: (id: string) => void;
  onExecute: (id: string) => void;
  onRemove: (id: string) => void;
}

function ProposalCard({
  proposal,
  connectedAddress,
  submitting,
  txStatus,
  txHash,
  onApprove,
  onExecute,
  onRemove,
}: ProposalCardProps) {
  const hasApproved = proposal.approvals.some((a) => a.signer === connectedAddress);
  const isRequiredSigner = connectedAddress
    ? proposal.requiredSigners.includes(connectedAddress)
    : false;
  const ready = canExecute(proposal);
  const isTerminal = proposal.status === 'executed' || proposal.status === 'failed';
  const isActiveExecution = proposal.status === 'executing' || (submitting && ready);

  return (
    <article
      aria-label={`Proposal: ${proposal.functionName} on ${truncateAddress(proposal.contractAddress)}`}
      className="rounded-xl border border-neutral-700/60 bg-neutral-800/50 p-5 space-y-4 shadow-md"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-neutral-100 truncate">
            {proposal.functionName}
          </p>
          <p className="font-mono text-xs text-neutral-500 mt-0.5 truncate">
            {proposal.contractAddress}
          </p>
        </div>
        <StatusBadge status={proposal.status} />
      </div>

      {/* Task metadata */}
      <dl className="grid grid-cols-2 gap-2 text-xs text-neutral-400">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-neutral-600">Interval</dt>
          <dd className="text-neutral-300 font-mono">{proposal.intervalSeconds}s</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-neutral-600">Gas</dt>
          <dd className="text-neutral-300 font-mono">{proposal.gasBalanceXlm} XLM</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-neutral-600">Proposed by</dt>
          <dd className="text-neutral-300 font-mono">{truncateAddress(proposal.proposedBy)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-neutral-600">Created</dt>
          <dd className="text-neutral-300">
            {new Date(proposal.proposedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </dd>
        </div>
      </dl>

      {/* Approval progress */}
      <ApprovalProgress
        current={proposal.approvals.length}
        required={proposal.threshold}
      />

      {/* Signer status list */}
      <ul aria-label="Signer approval statuses" className="space-y-1">
        {proposal.requiredSigners.map((addr) => {
          const approved = proposal.approvals.some((a) => a.signer === addr);
          return (
            <li
              key={addr}
              className="flex items-center gap-2 text-xs"
              aria-label={`${truncateAddress(addr)} — ${approved ? 'approved' : 'pending'}`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full shrink-0 ${approved ? 'bg-green-400' : 'bg-neutral-600'}`}
              />
              <span className={`font-mono truncate ${approved ? 'text-neutral-300' : 'text-neutral-500'}`}>
                {truncateAddress(addr)}
                {addr === connectedAddress && (
                  <span className="ml-1.5 text-[10px] text-blue-400">you</span>
                )}
              </span>
              {approved && <span className="ml-auto text-green-400 text-[10px]">✓ Approved</span>}
            </li>
          );
        })}
      </ul>

      {/* Transaction status (shown during / after execution) */}
      {(isActiveExecution || isTerminal) && txStatus && (
        <div className="pt-1">
          <TransactionStatus
            status={txStatus}
            txHash={txHash ?? undefined}
          />
          {txHash && proposal.status === 'executed' && (
            <a
              href={`${STELLAR_EXPERT_BASE}/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              View on Stellar Expert ↗
            </a>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!isTerminal && (
        <div className="flex gap-2 pt-1">
          {/* Approve button — only for required signers who haven't approved yet */}
          {isRequiredSigner && !hasApproved && proposal.status === 'pending_approvals' && (
            <button
              type="button"
              id={`msig-approve-${proposal.id}`}
              onClick={() => onApprove(proposal.id)}
              disabled={submitting}
              aria-label={`Approve proposal ${proposal.id}`}
              className="flex-1 rounded-lg border border-blue-500/40 bg-blue-500/10 py-2 text-xs font-semibold text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Approve
            </button>
          )}

          {/* Execute button — when threshold is met or executing */}
          {(ready || proposal.status === 'executing') && (
            <button
              type="button"
              id={`msig-execute-${proposal.id}`}
              onClick={() => onExecute(proposal.id)}
              disabled={submitting || proposal.status === 'executing'}
              aria-label={`Execute proposal ${proposal.id}`}
              className="flex-1 rounded-lg bg-green-600 py-2 text-xs font-semibold text-white shadow-sm shadow-green-600/20 transition hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {proposal.status === 'executing' || submitting ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" aria-hidden="true" />
                  Executing…
                </span>
              ) : (
                'Execute On-Chain'
              )}
            </button>
          )}

          {/* Remove */}
          <button
            type="button"
            id={`msig-remove-${proposal.id}`}
            onClick={() => onRemove(proposal.id)}
            aria-label={`Remove proposal ${proposal.id}`}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-500 transition hover:border-red-500/40 hover:text-red-400"
          >
            Remove
          </button>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Root Component
// ---------------------------------------------------------------------------

type Tab = 'propose' | 'approvals';

/**
 * MultiSigTaskRegistration
 *
 * Wallet-gated entrypoint for the multi-sig task registration flow.
 * Renders a tab bar with "New Proposal" and "Active Proposals".
 */
export function MultiSigTaskRegistration() {
  const [activeTab, setActiveTab] = useState<Tab>('propose');
  const { session } = useWallet();
  const {
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
  } = useMultiSigRegistration();

  const pendingCount = proposals.filter(
    (p) => p.status === 'pending_approvals' || p.status === 'ready'
  ).length;

  return (
    <WalletGate message="Connect your Freighter wallet to create or approve multi-sig task proposals.">
      <section
        aria-labelledby="multisig-heading"
        className="rounded-2xl border border-neutral-700/60 bg-neutral-900/80 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="border-b border-neutral-800 bg-neutral-950/60 px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 id="multisig-heading" className="text-lg font-bold text-neutral-100">
                Multi-Sig Task Registration
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Propose, approve, and execute task registrations with team sign-off
              </p>
            </div>
            {/* Connected wallet indicator */}
            {session?.address && (
              <span className="flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs font-mono text-neutral-300">
                <span className="h-2 w-2 rounded-full bg-green-400" aria-hidden="true" />
                {truncateAddress(session.address)}
              </span>
            )}
          </div>

          {/* Tab bar */}
          <div
            role="tablist"
            aria-label="Multi-sig flow sections"
            className="flex gap-1 mt-4 rounded-lg bg-neutral-800/50 p-1 w-fit"
          >
            <button
              role="tab"
              id="tab-propose"
              aria-selected={activeTab === 'propose'}
              aria-controls="panel-propose"
              onClick={() => setActiveTab('propose')}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'propose'
                  ? 'bg-neutral-700 text-neutral-100 shadow'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              New Proposal
            </button>
            <button
              role="tab"
              id="tab-approvals"
              aria-selected={activeTab === 'approvals'}
              aria-controls="panel-approvals"
              onClick={() => setActiveTab('approvals')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'approvals'
                  ? 'bg-neutral-700 text-neutral-100 shadow'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Active Proposals
              {pendingCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] text-white font-bold">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Tab panels */}
        <div className="p-6">
          {/* Panel: New Proposal */}
          <div
            role="tabpanel"
            id="panel-propose"
            aria-labelledby="tab-propose"
            hidden={activeTab !== 'propose'}
          >
            <ProposalForm
              onSubmit={(draft) => {
                proposeTask(draft);
                if (!error) setActiveTab('approvals');
              }}
              error={error}
              onDismissError={dismissError}
            />
          </div>

          {/* Panel: Active Proposals */}
          <div
            role="tabpanel"
            id="panel-approvals"
            aria-labelledby="tab-approvals"
            hidden={activeTab !== 'approvals'}
          >
            {/* Hook-level error banner */}
            {error && activeTab === 'approvals' && (
              <div
                role="alert"
                aria-live="assertive"
                className="mb-4 flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
              >
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  onClick={dismissError}
                  aria-label="Dismiss error"
                  className="text-red-400 hover:text-red-200 transition-colors"
                >
                  ✕
                </button>
              </div>
            )}

            {proposals.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <span className="text-4xl" aria-hidden="true">📋</span>
                <p className="text-sm text-neutral-400">No proposals yet.</p>
                <button
                  type="button"
                  onClick={() => setActiveTab('propose')}
                  className="mt-1 text-xs text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2"
                >
                  Create your first proposal →
                </button>
              </div>
            ) : (
              <div
                role="list"
                aria-label="Active proposals"
                className="space-y-4"
              >
                {proposals.map((proposal) => (
                  <div role="listitem" key={proposal.id}>
                    <ProposalCard
                      proposal={proposal}
                      connectedAddress={session?.address}
                      submitting={submitting}
                      txStatus={txStatus}
                      txHash={txHash}
                      onApprove={approveProposal}
                      onExecute={executeProposal}
                      onRemove={removeProposal}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </WalletGate>
  );
}

export default MultiSigTaskRegistration;
