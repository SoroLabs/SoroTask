const {
  LIMITS,
  TaskPayloadValidationError,
  assertValidTaskPayload,
  validateTaskPayload,
} = require("../src/taskPayloadValidator");

describe("task payload validation", () => {
  const validTaskConfig = {
    target: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    functionName: "execute_task",
  };

  test("accepts a bounded task payload", () => {
    const result = validateTaskPayload(validTaskConfig, [123, "memo", { retry: true }]);

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  test("rejects malformed task configuration early", () => {
    const result = validateTaskPayload({ target: "not-a-contract", functionName: "1bad" }, []);

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Soroban contract address/),
        expect.stringMatching(/valid identifier format/),
      ]),
    );
  });

  test("rejects oversized serialized payloads", () => {
    const result = validateTaskPayload(validTaskConfig, [
      "A".repeat(LIMITS.MAX_PAYLOAD_SIZE_BYTES),
    ]);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringMatching(/payload size/));
  });

  test("rejects too many arguments", () => {
    const args = Array.from({ length: LIMITS.MAX_ARGS_LENGTH + 1 }, (_, index) => index);

    const result = validateTaskPayload(validTaskConfig, args);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(`args cannot exceed ${LIMITS.MAX_ARGS_LENGTH} items.`);
  });

  test("rejects deep, extreme, or unsupported argument values", () => {
    const deepValue = {};
    let cursor = deepValue;
    for (let index = 0; index <= LIMITS.MAX_NESTING_DEPTH; index += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const result = validateTaskPayload(validTaskConfig, [
      "B".repeat(LIMITS.MAX_STRING_LENGTH + 1),
      BigInt(1),
      deepValue,
    ]);

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/maximum string length/),
        expect.stringMatching(/unsupported bigint/),
        expect.stringMatching(/maximum nesting depth/),
      ]),
    );
  });

  test("reports circular structures predictably", () => {
    const circular = [];
    circular.push(circular);

    const result = validateTaskPayload(validTaskConfig, circular);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("payload must be JSON serializable.");
  });

  test("throws a typed error for callers that need fail-fast behavior", () => {
    expect(() => assertValidTaskPayload(validTaskConfig, ["x".repeat(2000)])).toThrow(
      TaskPayloadValidationError,
    );
  });
});
