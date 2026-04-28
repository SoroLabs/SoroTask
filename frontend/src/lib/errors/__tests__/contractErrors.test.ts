import {
  ALL_CONTRACT_ERROR_CATEGORIES,
  isContractErrorCategory,
  mapContractError,
} from "../contractErrors";
import { RAW_ERROR_FIXTURES } from "../fixtures";

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

  it("classifies HTTP 5xx status codes as SERVER_ERROR", () => {
    expect(
      mapContractError({ message: "boom", status: 502 }).category,
    ).toBe("SERVER_ERROR");
    expect(
      mapContractError({ message: "boom", status: "503" }).category,
    ).toBe("SERVER_ERROR");
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

  it("flags retry-vs-fix actions correctly for the user-recovery path", () => {
    const rejected = mapContractError(RAW_ERROR_FIXTURES.WALLET_REJECTED);
    expect(rejected.action).toBe("retry");
    expect(rejected.retryable).toBe(true);

    const args = mapContractError(RAW_ERROR_FIXTURES.INVALID_ARGS);
    expect(args.action).toBe("fix_input");
    expect(args.retryable).toBe(false);

    const network = mapContractError(RAW_ERROR_FIXTURES.NETWORK_ERROR);
    expect(network.action).toBe("wait");
    expect(network.retryable).toBe(true);

    const dup = mapContractError(RAW_ERROR_FIXTURES.DUPLICATE_TRANSACTION);
    expect(dup.action).toBe("none");
    expect(dup.retryable).toBe(false);
  });
});

describe("isContractErrorCategory", () => {
  it("recognises every declared category", () => {
    for (const c of ALL_CONTRACT_ERROR_CATEGORIES) {
      expect(isContractErrorCategory(c)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isContractErrorCategory("NOT_A_CATEGORY")).toBe(false);
    expect(isContractErrorCategory("")).toBe(false);
  });
});
