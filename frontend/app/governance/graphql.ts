import type { SubgraphConfig } from "@/src/lib/graphql";
import type { AuditLogEntry } from "@/app/types/auditLog";
import { createVerifiedAuditEntry } from "./quadratic";
import type {
  GovernanceProposal,
  GovernanceVoteEvent,
  VoteChoice,
} from "./types";

export const GOVERNANCE_CONTRACT_ID =
  process.env.NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID ||
  "CGOV7SOROTASK4DAO2QUADRATIC9VOTING6CONTRACT3FUTURENET2A";

export const GOVERNANCE_EVENTS_QUERY = `
  query GovernanceVoteEvents($limit: Int) {
    events(limit: $limit) {
      id
      ledger_sequence
      contract_id
      event_name
      data_json
      processed_at
    }
  }
`;

export const GOVERNANCE_EVENT_SUBSCRIPTION = `
  subscription GovernanceEventAdded($contract_id: String) {
    eventAdded(contract_id: $contract_id) {
      id
      ledger_sequence
      contract_id
      event_name
      data_json
      processed_at
    }
  }
`;

export interface IndexerEventRecord {
  id: string;
  ledger_sequence: number;
  contract_id: string;
  event_name: string;
  data_json: string;
  processed_at: string;
}

export function getGovernanceSubgraphConfig(): SubgraphConfig {
  const httpUrl =
    process.env.NEXT_PUBLIC_INDEXER_GRAPHQL_URL ||
    "http://localhost:4000/graphql";
  const wsUrl =
    process.env.NEXT_PUBLIC_INDEXER_WS_URL ||
    httpUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

  return {
    url: httpUrl,
    wsUrl,
    name: "sorotask-governance-indexer",
    maxReconnectAttempts: 5,
    baseReconnectDelayMs: 1_500,
  };
}

export const DEFAULT_GOVERNANCE_PROPOSALS: GovernanceProposal[] = [
  {
    proposalId: 42,
    title: "SIP-042: Raise Keeper Execution Gas Ceiling & Lower Base Fee",
    description:
      "Adjusts the Soroban keeper gas ceiling from 50,000 to 85,000 stroops for complex multi-hop automations while reducing protocol relay commission from 150 bps to 100 bps.",
    category: "Parameters",
    proposer: "GB7K2M4X9Q3T6P8W5R2N1V4C7Z8L3D6F9H2J5K8M",
    targetContract: GOVERNANCE_CONTRACT_ID,
    targetFunction: "update_config",
    parameterChanges: [
      {
        parameter: "max_gas_ceiling",
        currentValue: "50,000 stroops",
        proposedValue: "85,000 stroops",
        impact: "medium",
      },
      {
        parameter: "relay_fee_bps",
        currentValue: "150 bps (1.50%)",
        proposedValue: "100 bps (1.00%)",
        impact: "high",
      },
    ],
    quorumThreshold: 1200,
    approvalThresholdBps: 5001,
    startBlock: 1_480_000,
    endBlock: 1_492_500,
    currentBlock: 1_489_120,
    status: "Active",
    votesFor: 760,
    votesAgainst: 185,
    votesAbstain: 55,
    voterCount: 94,
    createdAt: 1774800000000,
    executedAt: null,
    bountyXlm: 25,
  },
  {
    proposalId: 43,
    title: "SIP-043: Calibrate Circuit Breaker Veto Quorum to 12.5%",
    description:
      "Increases optimistic veto quorum for emergency circuit-breaker pauses from 1,000 bps (10%) to 1,250 bps (12.5%) to protect high-TVL vaults against flash-stake attacks.",
    category: "Security",
    proposer: "GD9P4L1V7C3X8B2N6M5K1J9H4G7F2D5S8A3Q6W9E",
    targetContract: "CBREAKER9SOROTASK2GUARDIAN7VETO4CONTRACT",
    targetFunction: "set_veto_quorum_bps",
    parameterChanges: [
      {
        parameter: "veto_quorum_bps",
        currentValue: "1,000 bps (10.0%)",
        proposedValue: "1,250 bps (12.5%)",
        impact: "high",
      },
      {
        parameter: "pause_ttl_ledgers",
        currentValue: "17,280 ledgers (~24h)",
        proposedValue: "25,920 ledgers (~36h)",
        impact: "medium",
      },
    ],
    quorumThreshold: 1500,
    approvalThresholdBps: 6000,
    startBlock: 1_482_000,
    endBlock: 1_495_000,
    currentBlock: 1_489_120,
    status: "Active",
    votesFor: 980,
    votesAgainst: 310,
    votesAbstain: 90,
    voterCount: 128,
    createdAt: 1774840000000,
    executedAt: null,
    bountyXlm: 40,
  },
  {
    proposalId: 44,
    title: "SIP-044: Expand Keeper Slashing Grace Window for RPC Failover",
    description:
      "Extends keeper missed-heartbeat grace window from 12 to 20 ledgers so automated RPC failover transitions do not trigger false-positive bond slashing.",
    category: "Keepers",
    proposer: "GA4W8E2R6T9Y1U5I3O7P2A6S8D4F9G1H5J3K7L2Z",
    targetContract: "CKEEPER6SLASHING3REG5SOROTASK8FUTURENET",
    targetFunction: "update_grace_window",
    parameterChanges: [
      {
        parameter: "heartbeat_grace_ledgers",
        currentValue: "12 ledgers",
        proposedValue: "20 ledgers",
        impact: "low",
      },
    ],
    quorumThreshold: 900,
    approvalThresholdBps: 5001,
    startBlock: 1_471_000,
    endBlock: 1_486_000,
    currentBlock: 1_489_120,
    status: "Passed",
    votesFor: 820,
    votesAgainst: 115,
    votesAbstain: 40,
    voterCount: 112,
    createdAt: 1774700000000,
    executedAt: null,
    bountyXlm: 15,
  },
];

export const DEFAULT_GOVERNANCE_AUDIT_LOGS: AuditLogEntry[] = [
  createVerifiedAuditEntry({
    id: "gov-audit-001",
    timestamp: 1774883200000,
    action: "governance.proposal_created [SIP-042]",
    actor: "GB7K2M4X...5K8M",
    severity: "info",
  }),
  createVerifiedAuditEntry({
    id: "gov-audit-002",
    timestamp: 1774883560000,
    action: "governance.vote_cast [SIP-042: +18 For | 324 XLM]",
    actor: "GD9P4L1V...6W9E",
    severity: "info",
  }),
  createVerifiedAuditEntry({
    id: "gov-audit-003",
    timestamp: 1774884120000,
    action: "governance.security_param_review [SIP-043: veto_quorum_bps]",
    actor: "GC3X8B2N...1J9H",
    severity: "warning",
  }),
  createVerifiedAuditEntry({
    id: "gov-audit-004",
    timestamp: 1774884900000,
    action: "governance.quorum_reached [SIP-044: 975/900 votes]",
    actor: "GA4W8E2R...7L2Z",
    severity: "critical",
  }),
];

function normalizeVoteChoice(raw: unknown): VoteChoice | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (lower === "for" || lower === "yes" || lower === "approve") return "For";
  if (lower === "against" || lower === "no" || lower === "reject")
    return "Against";
  if (lower === "abstain") return "Abstain";
  return null;
}

/**
 * Parse a raw indexer GraphQL `Event` into a typed governance vote event.
 * Returns null for non-governance or malformed payloads.
 */
export function parseGovernanceVoteEvent(
  event: IndexerEventRecord,
): GovernanceVoteEvent | null {
  const name = event.event_name.toLowerCase();
  if (
    !name.includes("vote") &&
    !name.includes("governance") &&
    !name.includes("gov")
  ) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.data_json) as Record<string, unknown>;
  } catch {
    return null;
  }

  const proposalId = Number(parsed.proposal_id ?? parsed.proposalId);
  const votes = Math.floor(Number(parsed.weight ?? parsed.votes ?? 0));
  const choice = normalizeVoteChoice(parsed.choice ?? parsed.vote_choice);
  const voter =
    typeof parsed.voter === "string" && parsed.voter.trim().length > 0
      ? parsed.voter.trim()
      : "GUNKNOWN...VOTER";

  if (
    !Number.isFinite(proposalId) ||
    proposalId <= 0 ||
    !choice ||
    votes <= 0
  ) {
    return null;
  }

  const stakeCost = Number(
    parsed.stake_cost ?? parsed.stakeCost ?? votes * votes,
  );
  const parsedTime = Date.parse(event.processed_at);

  return {
    eventId: String(event.id),
    proposalId,
    voter,
    choice,
    votes,
    stakeCost: Number.isFinite(stakeCost) ? stakeCost : votes * votes,
    ledgerSequence: Number(event.ledger_sequence) || 0,
    timestamp: Number.isFinite(parsedTime) ? parsedTime : Date.now(),
  };
}

/**
 * Immutably apply a live vote event to the proposal list.
 */
export function applyVoteEventToProposals(
  proposals: GovernanceProposal[],
  voteEvent: GovernanceVoteEvent,
): GovernanceProposal[] {
  return proposals.map((proposal) => {
    if (proposal.proposalId !== voteEvent.proposalId) {
      return proposal;
    }

    const votesFor =
      proposal.votesFor + (voteEvent.choice === "For" ? voteEvent.votes : 0);
    const votesAgainst =
      proposal.votesAgainst +
      (voteEvent.choice === "Against" ? voteEvent.votes : 0);
    const votesAbstain =
      proposal.votesAbstain +
      (voteEvent.choice === "Abstain" ? voteEvent.votes : 0);

    return {
      ...proposal,
      votesFor,
      votesAgainst,
      votesAbstain,
      voterCount: proposal.voterCount + 1,
      lastEventLedger: Math.max(
        proposal.lastEventLedger ?? 0,
        voteEvent.ledgerSequence,
      ),
    };
  });
}

export function voteEventToAuditLog(event: GovernanceVoteEvent): AuditLogEntry {
  const shortVoter =
    event.voter.length > 14
      ? `${event.voter.slice(0, 8)}...${event.voter.slice(-4)}`
      : event.voter;

  return createVerifiedAuditEntry({
    id: `idx-${event.eventId}`,
    timestamp: event.timestamp,
    action: `governance.vote_cast [SIP-${String(event.proposalId).padStart(3, "0")}: +${event.votes} ${event.choice} | ${event.stakeCost} XLM]`,
    actor: shortVoter,
    severity: event.votes >= 25 ? "warning" : "info",
  });
}

/**
 * Fetch recent indexed governance events over HTTP GraphQL.
 * Throws on network/GraphQL error so the hook can transparently switch to fallback mode.
 */
export async function fetchGovernanceEvents(
  graphqlUrl: string,
  limit = 25,
  signal?: AbortSignal,
): Promise<GovernanceVoteEvent[]> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: GOVERNANCE_EVENTS_QUERY,
      variables: { limit },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Indexer GraphQL returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: { events?: IndexerEventRecord[] };
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }

  const records = payload.data?.events ?? [];
  const parsed: GovernanceVoteEvent[] = [];
  for (const record of records) {
    const vote = parseGovernanceVoteEvent(record);
    if (vote) parsed.push(vote);
  }
  return parsed;
}
