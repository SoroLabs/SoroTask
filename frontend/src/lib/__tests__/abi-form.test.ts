import {
  buildInitialFormState,
  updateField,
  validateAll,
  serializeArgs,
  type AbiFunction,
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
