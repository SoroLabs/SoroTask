import {
  applyVoteEventToProposals,
  DEFAULT_GOVERNANCE_PROPOSALS,
  fetchGovernanceEvents,
  getGovernanceSubgraphConfig,
  parseGovernanceVoteEvent,
  voteEventToAuditLog,
} from "../graphql";
import { verifyAuditEntryIntegrity } from "../quadratic";

describe("Governance Indexer GraphQL Helpers", () => {
  it("derives http and ws subgraph config", () => {
    const config = getGovernanceSubgraphConfig();
    expect(config.url).toContain("graphql");
    expect(config.wsUrl).toMatch(/^wss?:\/\//);
    expect(config.name).toBe("sorotask-governance-indexer");
  });

  it("parses valid governance vote events and ignores non-governance or malformed records", () => {
    const valid = parseGovernanceVoteEvent({
      id: "ev-1",
      ledger_sequence: 1490001,
      contract_id: "CGOV",
      event_name: "VoteCast",
      data_json: JSON.stringify({
        proposal_id: 42,
        voter: "GB7K2M4X9Q3T6P8W5R2N1V4C7Z8L3D6F9H2J5K8M",
        choice: "for",
        weight: 15,
        stake_cost: 225,
      }),
      processed_at: "2026-11-24T12:00:00.000Z",
    });

    expect(valid).toEqual({
      eventId: "ev-1",
      proposalId: 42,
      voter: "GB7K2M4X9Q3T6P8W5R2N1V4C7Z8L3D6F9H2J5K8M",
      choice: "For",
      votes: 15,
      stakeCost: 225,
      ledgerSequence: 1490001,
      timestamp: Date.parse("2026-11-24T12:00:00.000Z"),
    });

    const against = parseGovernanceVoteEvent({
      id: "ev-2",
      ledger_sequence: 1490002,
      contract_id: "CGOV",
      event_name: "governance_vote",
      data_json: JSON.stringify({
        proposalId: 42,
        vote_choice: "reject",
        votes: 4,
      }),
      processed_at: "not-a-date",
    });
    expect(against?.choice).toBe("Against");
    expect(against?.stakeCost).toBe(16);
    expect(against?.voter).toBe("GUNKNOWN...VOTER");

    const abstain = parseGovernanceVoteEvent({
      id: "ev-3",
      ledger_sequence: 1490003,
      contract_id: "CGOV",
      event_name: "gov_ballot",
      data_json: JSON.stringify({
        proposal_id: 43,
        choice: "abstain",
        weight: 5,
      }),
      processed_at: "2026-11-24T12:00:00.000Z",
    });
    expect(abstain?.choice).toBe("Abstain");

    expect(
      parseGovernanceVoteEvent({
        id: "ev-4",
        ledger_sequence: 1,
        contract_id: "CTASK",
        event_name: "KeeperPaid",
        data_json: "{}",
        processed_at: "2026-11-24T12:00:00.000Z",
      }),
    ).toBeNull();

    expect(
      parseGovernanceVoteEvent({
        id: "ev-5",
        ledger_sequence: 1,
        contract_id: "CGOV",
        event_name: "VoteCast",
        data_json: "{invalid",
        processed_at: "2026-11-24T12:00:00.000Z",
      }),
    ).toBeNull();

    expect(
      parseGovernanceVoteEvent({
        id: "ev-6",
        ledger_sequence: 1,
        contract_id: "CGOV",
        event_name: "VoteCast",
        data_json: JSON.stringify({
          proposal_id: 42,
          choice: "maybe",
          weight: 0,
        }),
        processed_at: "2026-11-24T12:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("immutably updates For, Against, and Abstain tallies and converts vote events into verified audit entries", () => {
    const forEvent = {
      eventId: "ev-99",
      proposalId: 42,
      voter: "GB7K2M4X9Q3T6P8W5R2N1V4C7Z8L3D6F9H2J5K8M",
      choice: "For" as const,
      votes: 30,
      stakeCost: 900,
      ledgerSequence: 1490100,
      timestamp: 1774886000000,
    };

    const againstEvent = {
      eventId: "ev-100",
      proposalId: 42,
      voter: "GSHORT",
      choice: "Against" as const,
      votes: 10,
      stakeCost: 100,
      ledgerSequence: 1490101,
      timestamp: 1774886001000,
    };

    const abstainEvent = {
      eventId: "ev-101",
      proposalId: 42,
      voter: "GSHORT",
      choice: "Abstain" as const,
      votes: 5,
      stakeCost: 25,
      ledgerSequence: 1490102,
      timestamp: 1774886002000,
    };

    let updated = applyVoteEventToProposals(
      DEFAULT_GOVERNANCE_PROPOSALS,
      forEvent,
    );
    updated = applyVoteEventToProposals(updated, againstEvent);
    updated = applyVoteEventToProposals(updated, abstainEvent);

    const p42 = updated.find((p) => p.proposalId === 42)!;
    const orig42 = DEFAULT_GOVERNANCE_PROPOSALS.find(
      (p) => p.proposalId === 42,
    )!;

    expect(p42.votesFor).toBe(orig42.votesFor + 30);
    expect(p42.votesAgainst).toBe(orig42.votesAgainst + 10);
    expect(p42.votesAbstain).toBe(orig42.votesAbstain + 5);
    expect(p42.voterCount).toBe(orig42.voterCount + 3);
    expect(p42.lastEventLedger).toBe(1490102);
    expect(orig42.votesFor).toBe(760);

    const highSeverityAudit = voteEventToAuditLog(forEvent);
    expect(highSeverityAudit.severity).toBe("warning");
    expect(highSeverityAudit.actor).toBe("GB7K2M4X...5K8M");
    expect(verifyAuditEntryIntegrity(highSeverityAudit)).toBe(true);

    const normalAudit = voteEventToAuditLog(againstEvent);
    expect(normalAudit.severity).toBe("info");
    expect(normalAudit.actor).toBe("GSHORT");
    expect(verifyAuditEntryIntegrity(normalAudit)).toBe(true);
  });

  it("fetches governance events over HTTP GraphQL and handles errors", async () => {
    const originalFetch = global.fetch;

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          events: [
            {
              id: "http-1",
              ledger_sequence: 1490010,
              contract_id: "CGOV",
              event_name: "VoteCast",
              data_json: JSON.stringify({
                proposal_id: 42,
                voter: "GSHORT",
                choice: "For",
                weight: 5,
              }),
              processed_at: "2026-11-24T12:00:00.000Z",
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const events = await fetchGovernanceEvents("http://localhost:4000/graphql");
    expect(events).toHaveLength(1);
    expect(events[0].votes).toBe(5);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
    }) as unknown as typeof fetch;

    await expect(
      fetchGovernanceEvents("http://localhost:4000/graphql"),
    ).rejects.toThrow("HTTP 503");

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        errors: [{ message: "Subgraph syncing" }],
      }),
    }) as unknown as typeof fetch;

    await expect(
      fetchGovernanceEvents("http://localhost:4000/graphql"),
    ).rejects.toThrow("Subgraph syncing");

    global.fetch = originalFetch;
  });
});
