import { auditContractTarget, KNOWN_MALICIOUS_ADDRESSES } from "../phishingDefense";

describe("Phishing Defense & Pre-flight Security", () => {
  it("flags known malicious addresses as CRITICAL risk", () => {
    const malicious = Array.from(KNOWN_MALICIOUS_ADDRESSES)[0];
    const audit = auditContractTarget(malicious);

    expect(audit.isBlacklisted).toBe(true);
    expect(audit.riskLevel).toBe("CRITICAL");
    expect(audit.warnings).toHaveLength(1);
  });

  it("identifies malformed Soroban contract identifiers", () => {
    const audit = auditContractTarget("0xInvalidHexAddress");
    expect(audit.riskLevel).toBe("HIGH");
    expect(audit.warnings[0]).toContain("Invalid Soroban contract address format");
  });

  it("passes verified contracts on recognized origins as LOW risk", () => {
    const valid = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const audit = auditContractTarget(valid, "app.sorotask.org");
    expect(audit.isBlacklisted).toBe(false);
    expect(audit.riskLevel).toBe("LOW");
    expect(audit.warnings).toHaveLength(0);
  });
});
