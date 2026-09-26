import {
  decodeSorobanContractError,
  mapContractError,
  CONTRACT_ERROR_DEFINITIONS,
} from "../contractErrors";

describe("contractErrors", () => {
  it("maps every single contract error code from 1 to 705 defined in contract/src/lib.rs", () => {
    const errorCodes = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
      49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 65, 66, 67, 68, 69, 411, 412, 413, 414, 415,
      416, 417, 418, 419, 420, 600, 601, 602, 700, 701, 702, 703, 704, 705,
    ];

    for (const code of errorCodes) {
      const decoded = decodeSorobanContractError(code);
      expect(decoded).not.toBeNull();
      expect(decoded?.code).toBe(code);
      expect(decoded?.name).toBeDefined();
      expect(decoded?.explanation).toBeDefined();
      expect(decoded?.fixSuggestion).toBeDefined();
    }
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
