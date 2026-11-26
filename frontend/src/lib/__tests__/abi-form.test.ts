import {
  buildInitialFormState,
  updateField,
  validateAll,
  serializeArgs,
  generateAbiFormDescriptors,
  getFunctionZodSchema,
  encodeToScVal,
  fetchAbiFromRegistry,
  clearAbiCache,
  type AbiFunction,
  type ContractAbi,
} from "@/src/lib/abi-form";

const HARVEST_FN: AbiFunction = {
  name: "harvest_yield",
  inputs: [
    { name: "vault_address", type: "address" },
    { name: "amount", type: "u64" },
    { name: "reinvest", type: "bool" },
    { name: "memo", type: "string", optional: true },
  ],
  outputs: [],
};

const NO_INPUT_FN: AbiFunction = {
  name: "pause",
  inputs: [],
  outputs: [],
};

describe("buildInitialFormState", () => {
  it("creates fields for each input", () => {
    const state = buildInitialFormState(HARVEST_FN);
    expect(Object.keys(state.fields)).toEqual(["vault_address", "amount", "reinvest", "memo"]);
  });

  it("defaults bool to false", () => {
    const state = buildInitialFormState(HARVEST_FN);
    expect(state.fields["reinvest"].value).toBe(false);
  });

  it("defaults string fields to empty string", () => {
    const state = buildInitialFormState(HARVEST_FN);
    expect(state.fields["vault_address"].value).toBe("");
  });

  it("isValid is true when there are no inputs", () => {
    expect(buildInitialFormState(NO_INPUT_FN).isValid).toBe(true);
  });

  it("isValid is false when required fields are empty", () => {
    expect(buildInitialFormState(HARVEST_FN).isValid).toBe(false);
  });
});

describe("updateField", () => {
  it("sets the value", () => {
    let state = buildInitialFormState(HARVEST_FN);
    state = updateField(state, "amount", "100");
    expect(state.fields["amount"].value).toBe("100");
  });

  it("clears error on valid input", () => {
    let state = buildInitialFormState(HARVEST_FN);
    state = validateAll(state);
    state = updateField(state, "amount", "42");
    expect(state.fields["amount"].error).toBeNull();
  });

  it("sets error on invalid address", () => {
    let state = buildInitialFormState(HARVEST_FN);
    state = updateField(state, "vault_address", "not-an-address");
    expect(state.fields["vault_address"].error).toBeTruthy();
  });

  it("accepts valid stellar address starting with G", () => {
    const addr = "GABCDE" + "A".repeat(50);
    let state = buildInitialFormState(HARVEST_FN);
    state = updateField(state, "vault_address", addr);
    expect(state.fields["vault_address"].error).toBeNull();
  });

  it("accepts valid stellar address starting with C", () => {
    const addr = "CABCDE" + "A".repeat(50);
    let state = buildInitialFormState(HARVEST_FN);
    state = updateField(state, "vault_address", addr);
    expect(state.fields["vault_address"].error).toBeNull();
  });

  it("rejects negative value for u64", () => {
    let state = buildInitialFormState(HARVEST_FN);
    state = updateField(state, "amount", "-5");
    expect(state.fields["amount"].error).toBeTruthy();
  });

  it("accepts negative value for i64", () => {
    const fn: AbiFunction = { name: "f", inputs: [{ name: "x", type: "i64" }], outputs: [] };
    let state = buildInitialFormState(fn);
    state = updateField(state, "x", "-10");
    expect(state.fields["x"].error).toBeNull();
  });

  it("optional field accepts empty string", () => {
    let state = buildInitialFormState(HARVEST_FN);
    state = updateField(state, "memo", "");
    expect(state.fields["memo"].error).toBeNull();
  });

  it("returns unchanged state for unknown field name", () => {
    const state = buildInitialFormState(HARVEST_FN);
    const next = updateField(state, "unknown", "val");
    expect(next).toBe(state);
  });

  it("updates isValid when all required fields are filled", () => {
    const addr = "GABCDE" + "A".repeat(50);
    let state = buildInitialFormState(HARVEST_FN);
    state = updateField(state, "vault_address", addr);
    state = updateField(state, "amount", "100");
    expect(state.isValid).toBe(true);
  });
});

describe("validateAll", () => {
  it("sets errors on all empty required fields", () => {
    const state = validateAll(buildInitialFormState(HARVEST_FN));
    expect(state.fields["vault_address"].error).toBeTruthy();
    expect(state.fields["amount"].error).toBeTruthy();
    expect(state.isValid).toBe(false);
  });

  it("isValid true when all required fields are valid", () => {
    const addr = "GABCDE" + "A".repeat(50);
    let state = buildInitialFormState(HARVEST_FN);
    state = updateField(state, "vault_address", addr);
    state = updateField(state, "amount", "999");
    state = validateAll(state);
    expect(state.isValid).toBe(true);
  });
});

describe("serializeArgs", () => {
  it("returns field values keyed by param name", () => {
    const addr = "GABCDE" + "A".repeat(50);
    let state = buildInitialFormState(HARVEST_FN);
    state = updateField(state, "vault_address", addr);
    state = updateField(state, "amount", "5");

    const args = serializeArgs(state);
    expect(args["vault_address"]).toBe(addr);
    expect(args["amount"]).toBe("5");
    expect(args["reinvest"]).toBe(false);
  });
});

describe("Soroban Symbol, Complex Structs & Arrays", () => {
  const COMPLEX_FN: AbiFunction = {
    name: "execute_strategy",
    inputs: [
      { name: "action", type: "symbol" },
      {
        name: "targets",
        type: "vec",
        specType: { type: "vec", elementType: "address" },
      },
      {
        name: "weights",
        type: "array",
        specType: { type: "array", elementType: "u32", size: 2 },
      },
      {
        name: "config",
        type: "struct",
        specType: {
          type: "struct",
          name: "StrategyConfig",
          fields: [
            { name: "slippage_bps", type: "u32" },
            { name: "recipient", type: "address" },
            { name: "active", type: "bool" },
          ],
        },
      },
    ],
    outputs: [],
  };

  const VALID_ADDR = "GABCDE" + "A".repeat(50);

  it("validates symbol parameters and rejects invalid symbols", () => {
    let state = buildInitialFormState(COMPLEX_FN);
    state = updateField(state, "action", "rebalance_pool");
    expect(state.fields["action"].error).toBeNull();

    state = updateField(state, "action", "invalid-symbol!");
    expect(state.fields["action"].error).toBeTruthy();

    state = updateField(state, "action", "a".repeat(33));
    expect(state.fields["action"].error).toBeTruthy();
  });

  it("validates vec of addresses and rejects invalid elements", () => {
    let state = buildInitialFormState(COMPLEX_FN);
    state = updateField(state, "targets", [VALID_ADDR]);
    expect(state.fields["targets"].error).toBeNull();

    state = updateField(state, "targets", ["bad-address"]);
    expect(state.fields["targets"].error).toBeTruthy();
  });

  it("validates fixed-size arrays and enforces exact length", () => {
    let state = buildInitialFormState(COMPLEX_FN);
    state = updateField(state, "weights", [50, 50]);
    expect(state.fields["weights"].error).toBeNull();

    state = updateField(state, "weights", [100]);
    expect(state.fields["weights"].error).toBeTruthy();
  });

  it("validates complex structs as objects or JSON strings", () => {
    let state = buildInitialFormState(COMPLEX_FN);
    state = updateField(state, "config", {
      slippage_bps: 100,
      recipient: VALID_ADDR,
      active: true,
    });
    expect(state.fields["config"].error).toBeNull();

    state = updateField(
      state,
      "config",
      JSON.stringify({ slippage_bps: -5, recipient: VALID_ADDR, active: true }),
    );
    expect(state.fields["config"].error).toBeTruthy();

    state = updateField(state, "config", "{invalid-json");
    expect(state.fields["config"].error).toContain("valid JSON");
  });

  it("auto-generates field descriptors matching contract function signature", () => {
    const descriptors = generateAbiFormDescriptors(COMPLEX_FN);
    expect(descriptors.map((d) => d.name)).toEqual([
      "action",
      "targets",
      "weights",
      "config",
    ]);
    expect(descriptors[1].inputType).toBe("array");
    expect(descriptors[2].fixedLength).toBe(2);
    expect(descriptors[3].inputType).toBe("struct");
    expect(descriptors[3].fields?.map((f) => f.name)).toEqual([
      "slippage_bps",
      "recipient",
      "active",
    ]);
  });

  it("encodes symbol, vec, and struct to ScVal", () => {
    const sym = encodeToScVal("swap", { name: "action", type: "symbol" });
    expect(sym).toEqual({ tag: "Symbol", values: ["swap"] });

    const structVal = encodeToScVal(
      { slippage_bps: 50, recipient: VALID_ADDR, active: true },
      COMPLEX_FN.inputs[3],
    ) as { tag: string; values: unknown[] };
    expect(structVal.tag).toBe("Map");
    expect(structVal.values).toHaveLength(3);
  });

  it("builds whole-function Zod schema", () => {
    const schema = getFunctionZodSchema(HARVEST_FN);
    const ok = schema.safeParse({
      vault_address: VALID_ADDR,
      amount: "18446744073709551615",
      reinvest: true,
    });
    expect(ok.success).toBe(true);
  });
});

describe("fetchAbiFromRegistry", () => {
  const MOCK_ABI: ContractAbi = {
    contractId: "C" + "A".repeat(55),
    functions: [HARVEST_FN],
  };

  beforeEach(() => {
    clearAbiCache();
    jest.restoreAllMocks();
  });

  it("fetches and caches ABI from registry", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_ABI,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await fetchAbiFromRegistry(MOCK_ABI.contractId, "testnet");
    const second = await fetchAbiFromRegistry(MOCK_ABI.contractId, "testnet");

    expect(first.contractId).toBe(MOCK_ABI.contractId);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws on non-ok response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      statusText: "Not Found",
    }) as unknown as typeof fetch;

    await expect(
      fetchAbiFromRegistry("C" + "B".repeat(55), "testnet"),
    ).rejects.toThrow("Failed to fetch ABI: Not Found");
  });
});
