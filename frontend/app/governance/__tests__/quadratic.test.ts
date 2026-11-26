import {
  calculateMarginalVoteCost,
  calculateMaxQuadraticVotes,
  calculateQuadraticCost,
  calculateQuadraticVote,
  computeAuditEntryHash,
  computeQuorumMetrics,
  createVerifiedAuditEntry,
  projectVoteImpact,
  verifyAuditEntryIntegrity,
} from "../quadratic";

describe("Quadratic Voting & Quorum Math", () => {
  it("computes max quadratic votes using floor(sqrt(stake))", () => {
    expect(calculateMaxQuadraticVotes(0)).toBe(0);
    expect(calculateMaxQuadraticVotes(-50)).toBe(0);
    expect(calculateMaxQuadraticVotes(Number.NaN)).toBe(0);
    expect(calculateMaxQuadraticVotes(1)).toBe(1);
    expect(calculateMaxQuadraticVotes(99)).toBe(9);
    expect(calculateMaxQuadraticVotes(100)).toBe(10);
    expect(calculateMaxQuadraticVotes(2500)).toBe(50);
  });

  it("computes quadratic cost and marginal next-vote cost accurately", () => {
    expect(calculateQuadraticCost(0)).toBe(0);
    expect(calculateQuadraticCost(-3)).toBe(0);
    expect(calculateQuadraticCost(12)).toBe(144);
    expect(calculateQuadraticCost(12.9)).toBe(144);

    expect(calculateMarginalVoteCost(0)).toBe(1);
    expect(calculateMarginalVoteCost(-2)).toBe(1);
    expect(calculateMarginalVoteCost(10)).toBe(21); // 11^2 - 10^2 = 21
  });

  it("returns complete quadratic breakdown and validation errors", () => {
    const valid = calculateQuadraticVote(10, 1000, 990);
    expect(valid).toEqual({
      desiredVotes: 10,
      maxVotes: 31,
      stakeRequired: 100,
      remainingStake: 900,
      marginalNextVoteCost: 21,
      effectiveWeight: 10,
      votingPowerSharePct: 1,
      canAfford: true,
      validationError: null,
    });

    const overBudget = calculateQuadraticVote(40, 1000, 500);
    expect(overBudget.canAfford).toBe(false);
    expect(overBudget.validationError).toMatch(/Insufficient stake/i);

    const zeroVotes = calculateQuadraticVote(0, 1000);
    expect(zeroVotes.canAfford).toBe(false);
    expect(zeroVotes.validationError).toMatch(/Select at least 1 vote/i);

    const noStake = calculateQuadraticVote(5, 0);
    expect(noStake.canAfford).toBe(false);
    expect(noStake.validationError).toMatch(/Stake at least 1 XLM/i);

    const invalidNum = calculateQuadraticVote(Number.NaN, 1000);
    expect(invalidNum.canAfford).toBe(false);
    expect(invalidNum.validationError).toMatch(/valid whole number/i);
  });

  it("computes quorum progress, approval bps, and projected vote impact", () => {
    const proposal = {
      votesFor: 600,
      votesAgainst: 300,
      votesAbstain: 100,
      quorumThreshold: 1200,
      approvalThresholdBps: 6000, // 60%
    };

    const metrics = computeQuorumMetrics(proposal);
    expect(metrics.totalVotesCast).toBe(1000);
    expect(metrics.quorumProgressPct).toBe(83.3);
    expect(metrics.quorumReached).toBe(false);
    expect(metrics.remainingForQuorum).toBe(200);
    expect(metrics.approvalPct).toBe(66.7);
    expect(metrics.passingApproval).toBe(true);
    expect(metrics.forPct).toBe(60);
    expect(metrics.againstPct).toBe(30);
    expect(metrics.abstainPct).toBe(10);

    const projected = projectVoteImpact(proposal, "For", 200);
    expect(projected.totalVotesCast).toBe(1200);
    expect(projected.quorumReached).toBe(true);
    expect(projected.quorumProgressPct).toBe(100);

    const projectedAgainst = projectVoteImpact(proposal, "Against", 50);
    expect(projectedAgainst.totalVotesCast).toBe(1050);

    const projectedAbstain = projectVoteImpact(proposal, "Abstain", 50);
    expect(projectedAbstain.totalVotesCast).toBe(1050);

    const empty = computeQuorumMetrics({
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      quorumThreshold: 500,
      approvalThresholdBps: 5001,
    });
    expect(empty.totalVotesCast).toBe(0);
    expect(empty.approvalPct).toBe(0);
    expect(empty.passingApproval).toBe(false);
  });

  it("creates and verifies tamper-evident audit hashes", () => {
    const entry = createVerifiedAuditEntry({
      id: "audit-1",
      timestamp: 1774883200000,
      action: "governance.vote_cast",
      actor: "GB123...XYZ",
      severity: "info",
    });

    expect(entry.payloadHash).toMatch(/^0x[0-9a-f]{16}$/);
    expect(computeAuditEntryHash(entry)).toBe(entry.payloadHash);
    expect(verifyAuditEntryIntegrity(entry)).toBe(true);
    expect(
      verifyAuditEntryIntegrity({ ...entry, action: "governance.tampered" }),
    ).toBe(false);
  });
});
