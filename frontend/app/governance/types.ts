export type VoteStatus =
  "Pending" | "Active" | "Passed" | "Rejected" | "Executed" | "Cancelled";

export type VoteChoice = "For" | "Against" | "Abstain";

export type ProposalCategory =
  "Parameters" | "Treasury" | "Security" | "Keepers";

export interface ParameterChange {
  parameter: string;
  currentValue: string;
  proposedValue: string;
  impact: "low" | "medium" | "high";
}

export interface GovernanceProposal {
  proposalId: number;
  title: string;
  description: string;
  category: ProposalCategory;
  proposer: string;
  targetContract: string;
  targetFunction: string;
  parameterChanges: ParameterChange[];
  /** Minimum total quadratic votes required for quorum */
  quorumThreshold: number;
  /** Approval threshold in basis points (e.g. 5001 = 50.01%) */
  approvalThresholdBps: number;
  startBlock: number;
  endBlock: number;
  currentBlock: number;
  status: VoteStatus;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  voterCount: number;
  createdAt: number;
  executedAt: number | null;
  bountyXlm: number;
  lastEventLedger?: number;
}

export interface QuadraticVoteCalculation {
  desiredVotes: number;
  maxVotes: number;
  stakeRequired: number;
  remainingStake: number;
  marginalNextVoteCost: number;
  effectiveWeight: number;
  votingPowerSharePct: number;
  canAfford: boolean;
  validationError: string | null;
}

export interface QuorumMetrics {
  totalVotesCast: number;
  quorumThreshold: number;
  quorumProgressPct: number;
  quorumReached: boolean;
  remainingForQuorum: number;
  approvalPct: number;
  approvalThresholdPct: number;
  passingApproval: boolean;
  forPct: number;
  againstPct: number;
  abstainPct: number;
}

export interface VoteReceipt {
  proposalId: number;
  choice: VoteChoice;
  votes: number;
  stakeCommitted: number;
  voter: string;
  txHash: string;
  signedXdr: string;
  submittedAt: number;
  network: string;
}

export interface GovernanceVoteEvent {
  eventId: string;
  proposalId: number;
  voter: string;
  choice: VoteChoice;
  votes: number;
  stakeCost: number;
  ledgerSequence: number;
  timestamp: number;
}

export type IndexerConnectionState =
  "live" | "connecting" | "reconnecting" | "fallback" | "error";

export const GOVERNANCE_STATUS_FILTERS: readonly ("All" | VoteStatus)[] = [
  "All",
  "Active",
  "Passed",
  "Executed",
];
