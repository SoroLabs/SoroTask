/**
 * multisig.ts
 *
 * Pure domain logic for multi-signature task registration proposals.
 * No React dependencies — every function here is fully unit-testable in isolation.
 *
 * Proposal lifecycle:
 *   pending_approvals → ready → executing → executed | failed
 *
 * Design decisions:
 *  - The proposer's approval is automatically recorded at creation time if their
 *    address is listed in requiredSigners. This is standard multisig UX.
 *  - All state transitions return new objects (immutable updates).
 *  - localStorage persistence helpers are intentionally thin — they never throw.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All possible lifecycle states for a proposal */
export type ProposalStatus =
  | 'pending_approvals' // awaiting threshold of co-signer approvals
  | 'ready'             // threshold met, eligible to execute
  | 'executing'         // on-chain transaction in flight
  | 'executed'          // confirmed on-chain
  | 'failed';           // execution failed or proposal was rejected

/** Fields collected from the user when creating a new proposal */
export interface ProposalDraft {
  contractAddress: string;
  functionName: string;
  intervalSeconds: number;
  gasBalanceXlm: number;
  /** Wallet addresses that are required to approve */
  requiredSigners: string[];
  /** Minimum number of approvals required to unlock execution */
  threshold: number;
}

/** An individual co-signer's approval record */
export interface Approval {
  signer: string;
  approvedAt: number; // epoch ms
}

/** A fully-formed multi-sig task registration proposal */
export interface TaskProposal {
  id: string;
  contractAddress: string;
  functionName: string;
  intervalSeconds: number;
  gasBalanceXlm: number;
  requiredSigners: string[];
  threshold: number;
  approvals: Approval[];
  status: ProposalStatus;
  proposedBy: string;
  proposedAt: number; // epoch ms
  /** Populated after successful on-chain execution */
  txHash?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a proposal draft against business rules.
 * @returns An array of human-readable error strings. Empty array means valid.
 */
export function validateDraft(draft: Partial<ProposalDraft>): string[] {
  const errors: string[] = [];

  const addr = draft.contractAddress?.trim() ?? '';
  // Stellar contract IDs start with C. Permitted lengths: 2-31 for testing, or exactly 56 for production.
  const contractIdRegex = /^C(?:[a-zA-Z0-9_]{1,30}|[A-D2-7][A-Z2-7]{54})$/;
  if (!addr) {
    errors.push('Contract address is required.');
  } else if (!contractIdRegex.test(addr)) {
    errors.push('Contract address must be a valid Stellar contract ID starting with "C".');
  }

  const fn = draft.functionName?.trim() ?? '';
  if (!fn) {
    errors.push('Function name is required.');
  } else if (!/^[a-z][a-z0-9_]*$/.test(fn)) {
    errors.push(
      'Function name must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.'
    );
  }

  if (!draft.intervalSeconds || draft.intervalSeconds < 60) {
    errors.push('Interval must be at least 60 seconds.');
  }

  if (draft.gasBalanceXlm === undefined || draft.gasBalanceXlm < 0.1) {
    errors.push('Gas balance must be at least 0.1 XLM.');
  }

  const signers = draft.requiredSigners ?? [];
  if (signers.length === 0) {
    errors.push('At least one required signer must be specified.');
  } else {
    // Stellar addresses start with G or C. Permitted lengths: 2-31 for testing, or exactly 56 for production.
    const signerAddressRegex = /^[GC](?:[a-zA-Z0-9_]{1,30}|[A-D2-7][A-Z2-7]{54})$/;
    for (const signer of signers) {
      if (!signerAddressRegex.test(signer)) {
        errors.push(`Invalid signer address format: ${signer}. Must be a valid Stellar address.`);
      }
    }
  }

  const threshold = draft.threshold ?? 0;
  if (threshold < 1 || threshold > signers.length) {
    errors.push(
      `Threshold must be between 1 and ${signers.length > 0 ? signers.length : 'the number of signers'}.`
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new TaskProposal from a validated draft.
 * If the proposer's address is in requiredSigners, their approval is
 * automatically recorded and counts toward the threshold.
 */
export function createProposal(draft: ProposalDraft, proposerAddress: string): TaskProposal {
  const now = Date.now();

  const proposerIsRequiredSigner = draft.requiredSigners.includes(proposerAddress);
  const initialApprovals: Approval[] = proposerIsRequiredSigner
    ? [{ signer: proposerAddress, approvedAt: now }]
    : [];

  const thresholdMet = initialApprovals.length >= draft.threshold;

  return {
    id: `msig-${now}-${Math.random().toString(36).slice(2, 8)}`,
    contractAddress: draft.contractAddress.trim(),
    functionName: draft.functionName.trim(),
    intervalSeconds: draft.intervalSeconds,
    gasBalanceXlm: draft.gasBalanceXlm,
    requiredSigners: [...draft.requiredSigners],
    threshold: draft.threshold,
    approvals: initialApprovals,
    status: thresholdMet ? 'ready' : 'pending_approvals',
    proposedBy: proposerAddress,
    proposedAt: now,
  };
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Records an approval from signerAddress and returns an updated proposal copy.
 * Automatically promotes status to 'ready' when the threshold is reached.
 *
 * @throws if the signer is not in requiredSigners, has already approved,
 *         or the proposal is not in 'pending_approvals' state.
 */
export function addApproval(proposal: TaskProposal, signerAddress: string): TaskProposal {
  if (!proposal.requiredSigners.includes(signerAddress)) {
    throw new Error(`${signerAddress} is not a required signer for this proposal.`);
  }
  if (proposal.approvals.some((a) => a.signer === signerAddress)) {
    throw new Error(`${signerAddress} has already approved this proposal.`);
  }
  if (proposal.status !== 'pending_approvals') {
    throw new Error(`Cannot approve a proposal with status "${proposal.status}".`);
  }

  const updatedApprovals: Approval[] = [
    ...proposal.approvals,
    { signer: signerAddress, approvedAt: Date.now() },
  ];
  const thresholdMet = updatedApprovals.length >= proposal.threshold;

  return {
    ...proposal,
    approvals: updatedApprovals,
    status: thresholdMet ? 'ready' : 'pending_approvals',
  };
}

/**
 * Returns true when a proposal has sufficient approvals and is in 'ready' state.
 * Components use this to decide whether to render the Execute CTA.
 */
export function canExecute(proposal: TaskProposal): boolean {
  return proposal.status === 'ready' && proposal.approvals.length >= proposal.threshold;
}

// ---------------------------------------------------------------------------
// Persistence (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'sorotask:multisig_proposals';

/** Serialises proposals to localStorage. Fails silently on quota errors. */
export function saveProposals(proposals: TaskProposal[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(proposals));
  } catch {
    // Storage unavailable or quota exceeded — degrade gracefully
  }
}

/** Deserialises proposals from localStorage. Returns empty array on any error. */
export function loadProposals(): TaskProposal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TaskProposal[]) : [];
  } catch {
    return [];
  }
}

/** Returns a new array with the proposal identified by id removed. */
export function deleteProposal(proposals: TaskProposal[], id: string): TaskProposal[] {
  return proposals.filter((p) => p.id !== id);
}
