import type { AuditLogEntry } from "@/app/types/auditLog";
import type {
  GovernanceProposal,
  QuadraticVoteCalculation,
  QuorumMetrics,
  VoteChoice,
} from "./types";

const MAX_SAFE_VOTES = 1_000_000;

/**
 * Maximum integer quadratic votes purchasable with `availableStake` tokens:
 * cost(v) = v^2 <= availableStake  =>  v_max = floor(sqrt(availableStake))
 */
export function calculateMaxQuadraticVotes(availableStake: number): number {
  if (!Number.isFinite(availableStake) || availableStake <= 0) {
    return 0;
  }
  return Math.min(MAX_SAFE_VOTES, Math.floor(Math.sqrt(availableStake)));
}

/**
 * Quadratic token cost required to cast `votes` votes: cost = votes^2.
 */
export function calculateQuadraticCost(votes: number): number {
  if (!Number.isFinite(votes) || votes <= 0) {
    return 0;
  }
  const normalized = Math.floor(votes);
  return normalized * normalized;
}

/**
 * Marginal token cost of adding 1 additional vote beyond `currentVotes`:
 * (v + 1)^2 - v^2 = 2v + 1.
 */
export function calculateMarginalVoteCost(currentVotes: number): number {
  if (!Number.isFinite(currentVotes) || currentVotes < 0) {
    return 1;
  }
  const normalized = Math.floor(currentVotes);
  return 2 * normalized + 1;
}

/**
 * Full quadratic voting breakdown for UI display and pre-signing validation.
 */
export function calculateQuadraticVote(
  desiredVotes: number,
  availableStake: number,
  existingProposalVotes = 0,
): QuadraticVoteCalculation {
  const safeStake =
    Number.isFinite(availableStake) && availableStake > 0 ? availableStake : 0;
  const maxVotes = calculateMaxQuadraticVotes(safeStake);

  if (!Number.isFinite(desiredVotes)) {
    return {
      desiredVotes: 0,
      maxVotes,
      stakeRequired: 0,
      remainingStake: safeStake,
      marginalNextVoteCost: 1,
      effectiveWeight: 0,
      votingPowerSharePct: 0,
      canAfford: false,
      validationError: "Enter a valid whole number of votes.",
    };
  }

  const normalizedVotes = Math.max(0, Math.floor(desiredVotes));
  const stakeRequired = calculateQuadraticCost(normalizedVotes);
  const marginalNextVoteCost = calculateMarginalVoteCost(normalizedVotes);
  const canAfford = normalizedVotes > 0 && stakeRequired <= safeStake;
  const remainingStake = Math.max(
    0,
    Number((safeStake - stakeRequired).toFixed(4)),
  );

  const projectedTotal = Math.max(0, existingProposalVotes) + normalizedVotes;
  const votingPowerSharePct =
    projectedTotal > 0
      ? Number(((normalizedVotes / projectedTotal) * 100).toFixed(2))
      : 0;

  let validationError: string | null = null;
  if (safeStake <= 0) {
    validationError = "Stake at least 1 XLM to cast a quadratic vote.";
  } else if (normalizedVotes <= 0) {
    validationError = "Select at least 1 vote to cast.";
  } else if (stakeRequired > safeStake) {
    validationError = `Insufficient stake: ${stakeRequired.toLocaleString()} XLM required (max ${maxVotes.toLocaleString()} votes).`;
  }

  return {
    desiredVotes: normalizedVotes,
    maxVotes,
    stakeRequired,
    remainingStake,
    marginalNextVoteCost,
    effectiveWeight: normalizedVotes,
    votingPowerSharePct,
    canAfford,
    validationError,
  };
}

/**
 * Compute quorum progress and approval metrics matching `contract/src/governance.rs`.
 */
export function computeQuorumMetrics(
  proposal: Pick<
    GovernanceProposal,
    | "votesFor"
    | "votesAgainst"
    | "votesAbstain"
    | "quorumThreshold"
    | "approvalThresholdBps"
  >,
): QuorumMetrics {
  const votesFor = Math.max(0, proposal.votesFor);
  const votesAgainst = Math.max(0, proposal.votesAgainst);
  const votesAbstain = Math.max(0, proposal.votesAbstain);
  const totalVotesCast = votesFor + votesAgainst + votesAbstain;
  const quorumThreshold = Math.max(1, proposal.quorumThreshold);

  const rawProgress = (totalVotesCast / quorumThreshold) * 100;
  const quorumProgressPct = Number(Math.min(100, rawProgress).toFixed(1));
  const quorumReached = totalVotesCast >= quorumThreshold;
  const remainingForQuorum = Math.max(0, quorumThreshold - totalVotesCast);

  const decisiveVotes = votesFor + votesAgainst;
  const approvalPct =
    decisiveVotes > 0
      ? Number(((votesFor / decisiveVotes) * 100).toFixed(1))
      : 0;
  const approvalThresholdPct = Number(
    (proposal.approvalThresholdBps / 100).toFixed(2),
  );
  const passingApproval =
    decisiveVotes > 0 &&
    votesFor * 10_000 >= decisiveVotes * proposal.approvalThresholdBps;

  const forPct =
    totalVotesCast > 0
      ? Number(((votesFor / totalVotesCast) * 100).toFixed(1))
      : 0;
  const againstPct =
    totalVotesCast > 0
      ? Number(((votesAgainst / totalVotesCast) * 100).toFixed(1))
      : 0;
  const abstainPct =
    totalVotesCast > 0
      ? Number(((votesAbstain / totalVotesCast) * 100).toFixed(1))
      : 0;

  return {
    totalVotesCast,
    quorumThreshold,
    quorumProgressPct,
    quorumReached,
    remainingForQuorum,
    approvalPct,
    approvalThresholdPct,
    passingApproval,
    forPct,
    againstPct,
    abstainPct,
  };
}

/**
 * Preview how casting `additionalVotes` for `choice` shifts quorum and approval bars.
 */
export function projectVoteImpact(
  proposal: Pick<
    GovernanceProposal,
    | "votesFor"
    | "votesAgainst"
    | "votesAbstain"
    | "quorumThreshold"
    | "approvalThresholdBps"
  >,
  choice: VoteChoice,
  additionalVotes: number,
): QuorumMetrics {
  const delta = Math.max(
    0,
    Math.floor(Number.isFinite(additionalVotes) ? additionalVotes : 0),
  );
  return computeQuorumMetrics({
    ...proposal,
    votesFor: proposal.votesFor + (choice === "For" ? delta : 0),
    votesAgainst: proposal.votesAgainst + (choice === "Against" ? delta : 0),
    votesAbstain: proposal.votesAbstain + (choice === "Abstain" ? delta : 0),
  });
}

/**
 * Deterministic synchronous digest for tamper verification in AuditLogImmutableView.
 * Uses dual 32-bit FNV-1a lanes so integrity checks work without async WebCrypto latency.
 */
export function computeAuditEntryHash(
  entry: Pick<
    AuditLogEntry,
    "id" | "timestamp" | "action" | "actor" | "severity"
  >,
): string {
  const canonical = `${entry.id}|${entry.timestamp}|${entry.action}|${entry.actor}|${entry.severity}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < canonical.length; i += 1) {
    const code = canonical.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code ^ ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `0x${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export function createVerifiedAuditEntry(
  input: Omit<AuditLogEntry, "payloadHash">,
): AuditLogEntry {
  return {
    ...input,
    payloadHash: computeAuditEntryHash(input),
  };
}

export function verifyAuditEntryIntegrity(entry: AuditLogEntry): boolean {
  return computeAuditEntryHash(entry) === entry.payloadHash;
}
