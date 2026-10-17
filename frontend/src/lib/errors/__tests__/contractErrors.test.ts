import {
  ALL_CONTRACT_ERROR_CATEGORIES,
  decodeContractDiagnostic,
  isContractErrorCategory,
  mapContractError,
  CONTRACT_ERROR_DEFINITIONS,
} from "../contractErrors";

describe("mapContractError", () => {
  it.each(ALL_CONTRACT_ERROR_CATEGORIES)(
    "maps the %s fixture to the matching category",
    (category) => {
      const result = mapContractError(RAW_ERROR_FIXTURES[category]);
      expect(result.category).toBe(category);
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.userMessage.length).toBeGreaterThan(0);
    },
  );

  it("preserves the raw error and message in the debug payload", () => {
    const raw = Object.assign(new Error("boom"), { code: "TX_BAD_SEQ" });
    const result = mapContractError(raw);
    expect(result.debug.message).toBe("boom");
    expect(result.debug.code).toBe("TX_BAD_SEQ");
    expect(result.debug.raw).toBe(raw);
  });

  it("maps named Soroban host error types without numeric codes", () => {
    expect(
      mapContractError(
        new Error("HostError: Error(Budget, CpuLimitExceeded)"),
      ).category,
    ).toBe("INSUFFICIENT_GAS");
  });

  it("handles null and primitive inputs without throwing", () => {
    expect(mapContractError(null).category).toBe("UNKNOWN");
    expect(mapContractError(undefined).category).toBe("UNKNOWN");
    expect(mapContractError("just a string").category).toBe("UNKNOWN");
    expect(mapContractError(42).category).toBe("UNKNOWN");
  });

  it("falls back to UNKNOWN for errors it cannot classify", () => {
    const result = mapContractError(new Error("ELEVENTY-SEVEN"));
    expect(result.category).toBe("UNKNOWN");
    expect(result.action).toBe("retry");
  });

  it("recognises Soroban host traps as CONTRACT_REVERT, not SIMULATION_FAILED", () => {
    const trap = mapContractError(
      new Error("Simulation failed: VM error: contract panicked: bad input"),
    );
    expect(trap.category).toBe("CONTRACT_REVERT");

    const generic = mapContractError(
      new Error("Simulation failed: unknown reason"),
    );
    expect(generic.category).toBe("SIMULATION_FAILED");
  });

  it.each([
    ["Contract", "CONTRACT_REVERT"],
    ["Budget", "INSUFFICIENT_GAS"],
    ["Storage", "STATE_EXPIRED"],
    ["Auth", "BAD_AUTH"],
  ] as const)("maps Soroban %s host errors to %s", (domain, category) => {
    expect(
      mapContractError(new Error(`HostError: Error(${domain}, #2)`)).category,
    ).toBe(category);
  });

  it("decodes hex diagnostic text and translates a custom contract error code", () => {
    const diagnostic = "HostError: Error(Contract, #2)";
    const hex = `0x${Array.from(new TextEncoder().encode(diagnostic), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;

    const decoded = decodeContractDiagnostic(hex);

    expect(decoded.format).toBe("hex");
    expect(decoded.decodedText).toBe(diagnostic);
    expect(decoded.code).toBe("Error(Contract, #2)");
    expect(decoded.actionableMessage).toContain("custom error #2");
    expect(
      mapContractError({ message: "simulation failed", diagnosticPayload: hex })
        .category,
    ).toBe("CONTRACT_REVERT");
  });

  it("decodes base64 XDR text carried by Soroban error-result fields", () => {
    const diagnostic = "HostError: Error(Budget, #3)";
    const encoded = btoa(
      Array.from(new TextEncoder().encode(diagnostic), (byte) =>
        String.fromCharCode(byte),
      ).join(""),
    );
    const mapped = mapContractError({
      message: "Simulation failed",
      errorResultXdr: encoded,
    });

    expect(mapped.category).toBe("INSUFFICIENT_GAS");
    expect(mapped.userMessage).toContain("gas budget");
    expect(decodeContractDiagnostic(encoded).format).toBe("base64");
  });

  it("decodes diagnostic fields nested in Soroban RPC error responses", () => {
    const mapped = mapContractError({
      message: "Simulation failed",
      errorResultXdr: "HostError: Error(Budget, #1)",
    });

    expect(mapped.category).toBe("INSUFFICIENT_GAS");
    expect(mapped.userMessage).toContain("gas budget");
  });

  it("classifies HTTP 5xx status codes as SERVER_ERROR", () => {
    expect(
      mapContractError({ message: "boom", status: 502 }).category,
    ).toBe("SERVER_ERROR");
    expect(
      mapContractError({ message: "boom", status: "503" }).category,
    ).toBe("SERVER_ERROR");
  });

  it("recognises token allowance failures as a token approval requirement", () => {
    expect(
      mapContractError(
        Object.assign(new Error("allowance too low"), {
          code: "INSUFFICIENT_ALLOWANCE",
        }),
      ).category,
    ).toBe("TOKEN_APPROVAL_REQUIRED");
  });

  it("uses the keeper-style code map when both code and message disagree", () => {
    // The message contains 'timeout' (would map to TIMEOUT) but the code
    // wins because the keeper code map runs first.
    const result = mapContractError({
      message: "fetch timeout while building tx",
      code: "TX_BAD_SEQ",
    });
    expect(result.category).toBe("BAD_SEQUENCE");
  });

  it("decodes raw Soroban XDR error string streams", () => {
    const errorString = "HostError: Error(Contract, #3)";
    const decoded = decodeSorobanContractError(errorString);

    expect(decoded).not.toBeNull();
    expect(decoded?.code).toBe(3);
    expect(decoded?.name).toBe("InsufficientBalance");
    expect(decoded?.fixSuggestion).toContain("Increase gas escrow");
  });

  it("decodes keeper bond insufficient error code #418", () => {
    const errorString = "Error(Contract, #418)";
    const decoded = decodeSorobanContractError(errorString);

    expect(decoded).not.toBeNull();
    expect(decoded?.code).toBe(418);
    expect(decoded?.name).toBe("KeeperBondInsufficient");
  });
});
