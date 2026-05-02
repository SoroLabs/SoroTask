const { validateTaskPayload, LIMITS } = require("../src/utils/taskValidator");

describe("Task Payload Validation Hardening", () => {
  const validTarget =
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 56 chars, starts with C
  const validFunction = "harvest_yield";

  it("should pass a valid task configuration and arguments", () => {
    const taskConfig = { target: validTarget, function: validFunction };
    const args = ["arg1", 123, true];

    const result = validateTaskPayload(taskConfig, args);
    expect(result.isValid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should fail if the target is not a valid Soroban address", () => {
    const taskConfig = {
      target: "INVALID_ADDRESS",
      function: validFunction,
    };
    const result = validateTaskPayload(taskConfig);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/valid Soroban contract address/);
  });

  it("should fail if the payload exceeds maximum byte size", () => {
    const taskConfig = { target: validTarget, function: validFunction };
    // Create an artificially large array of arguments > 8KB
    const massiveString = "A".repeat(LIMITS.MAX_PAYLOAD_SIZE_BYTES + 100);
    const args = [massiveString];

    const result = validateTaskPayload(taskConfig, args);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/exceeds maximum allowed/);
  });

  it("should fail if there are too many arguments", () => {
    const taskConfig = { target: validTarget, function: validFunction };
    const args = new Array(LIMITS.MAX_ARGS_LENGTH + 1).fill("arg");

    const result = validateTaskPayload(taskConfig, args);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/cannot exceed 20 elements/);
  });

  it("should handle circular references safely", () => {
    const taskConfig = { target: validTarget, function: validFunction };
    const args = [];
    args.push(args); // Create circular reference

    const result = validateTaskPayload(taskConfig, args);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/cannot be serialized/);
  });

  it("should fail if taskConfig is missing or malformed", () => {
    const resultNull = validateTaskPayload(null);
    expect(resultNull.isValid).toBe(false);

    const resultString = validateTaskPayload("not an object");
    expect(resultString.isValid).toBe(false);

    const resultMissingFields = validateTaskPayload({});
    expect(resultMissingFields.isValid).toBe(false);
    expect(resultMissingFields.errors.length).toBeGreaterThan(0);
  });
});
