import {
  auditContractTarget,
  simulateContractExecution,
  KNOWN_MALICIOUS_ADDRESSES,
  VERIFIED_CONTRACTS,
} from "../phishingDefense";

describe("Phishing Defense & Pre-flight Security", () => {
  it("flags known malicious addresses as CRITICAL risk with warnings", () => {
    const malicious = Array.from(KNOWN_MALICIOUS_ADDRESSES)[0];
    const audit = auditContractTarget(malicious);

    expect(audit.isBlacklisted).toBe(true);
    expect(audit.riskLevel).toBe("CRITICAL");
    expect(audit.requiresConfirmation).toBe(true);
    expect(audit.warnings.length).toBeGreaterThan(0);
    expect(audit.warnings.some((w) => w.includes("phishing") || w.includes("blacklist"))).toBe(true);
  });

  it("identifies malformed Soroban contract identifiers", () => {
    const audit = auditContractTarget("0xInvalidHexAddress");
    expect(audit.riskLevel).toBe("HIGH");
    expect(audit.requiresConfirmation).toBe(true);
    expect(audit.warnings[0]).toContain("Invalid Soroban contract address format");
  });

  it("passes verified contracts on recognized origins as LOW risk", () => {
    const valid = Array.from(VERIFIED_CONTRACTS)[0];
    const audit = auditContractTarget(valid, "app.sorotask.org");
    expect(audit.isBlacklisted).toBe(false);
    expect(audit.isVerified).toBe(true);
    expect(audit.riskLevel).toBe("LOW");
    expect(audit.requiresConfirmation).toBe(false);
    expect(audit.warnings).toHaveLength(0);
  });

  it("warns about unverified contracts with prominent caution notices", () => {
    const unverified = "CBABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOPQRST";
    const audit = auditContractTarget(unverified, "app.sorotask.org");
    expect(audit.isBlacklisted).toBe(false);
    expect(audit.isVerified).toBe(false);
    expect(audit.riskLevel).toBe("MEDIUM");
    expect(audit.warnings.some((w) => w.includes("unverified"))).toBe(true);
  });

  it("simulates contract execution and detects unexpected drainer methods", () => {
    const valid = Array.from(VERIFIED_CONTRACTS)[0];
    const sim = simulateContractExecution(valid, {
      method: "drainAllLumens",
    });

    expect(sim.success).toBe(false);
    expect(sim.hasUnexpectedTransfers).toBe(true);
    expect(sim.riskLevel).toBe("CRITICAL");
    expect(sim.warnings.some((w) => w.includes("draining"))).toBe(true);
  });

  it("flags unexpected balance transfers in pre-flight audit", () => {
    const valid = Array.from(VERIFIED_CONTRACTS)[0];
    const audit = auditContractTarget(valid, "app.sorotask.org", {
      method: "claim_rewards",
      args: {
        recipient: "GBBADACTOR9999999999999999999999999999999999999999999999",
        amount: "50000",
      },
      allowedRecipient: "GLEGITIMATEUSER11111111111111111111111111111111111111111111",
    });

    expect(audit.riskLevel).toBe("CRITICAL");
    expect(audit.requiresConfirmation).toBe(true);
    expect(audit.simulation?.hasUnexpectedTransfers).toBe(true);
    expect(audit.warnings.some((w) => w.includes("unexpected recipient"))).toBe(true);
  });
});
