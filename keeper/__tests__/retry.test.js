/**
 * Unit tests for retry.js - Retry logic with exponential backoff
 */

const {
  withRetry,
  retry,
  isRetryableError,
  isDuplicateTransactionError,
  classifyError,
  extractErrorCode,
  ErrorClassification,
} = require("../src/retry.js");

describe("withRetry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("success cases", () => {
    it("should succeed on first attempt", async () => {
      const fn = jest.fn().mockResolvedValue("success");

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(result.result).toBe("success");
      expect(result.attempts).toBe(1);
      expect(result.retries).toBe(0);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should succeed on second attempt after retryable error", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("NETWORK_ERROR"))
        .mockResolvedValueOnce("success");

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(result.result).toBe("success");
      expect(result.attempts).toBe(2);
      expect(result.retries).toBe(1);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should succeed on third attempt", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("TIMEOUT"))
        .mockRejectedValueOnce(new Error("RATE_LIMITED"))
        .mockResolvedValueOnce("success");

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(result.retries).toBe(2);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe("duplicate transaction handling", () => {
    it("should treat DUPLICATE_TRANSACTION as success", async () => {
      const fn = jest
        .fn()
        .mockRejectedValue(new Error("DUPLICATE_TRANSACTION"));

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(true);
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should treat TX_ALREADY_IN_LEDGER as success", async () => {
      const fn = jest.fn().mockRejectedValue({
        code: "TX_ALREADY_IN_LEDGER",
        message: "Transaction already in ledger",
      });

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should call onDuplicate callback when duplicate detected", async () => {
      const onDuplicate = jest.fn();
      const fn = jest
        .fn()
        .mockRejectedValue(new Error("DUPLICATE_TRANSACTION"));

      await withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 10,
        onDuplicate,
      });

      expect(onDuplicate).toHaveBeenCalledTimes(1);
    });
  });

  describe("non-retryable errors", () => {
    it("should bail immediately on non-retryable error", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("INVALID_ARGS"));

      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }),
      ).rejects.toMatchObject({
        success: false,
        classification: ErrorClassification.NON_RETRYABLE,
        attempts: 1,
        retries: 0,
      });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should bail on CONTRACT_PANIC", async () => {
      const fn = jest.fn().mockRejectedValue({
        code: "CONTRACT_PANIC",
        message: "Contract panicked",
      });

      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }),
      ).rejects.toMatchObject({
        success: false,
        classification: ErrorClassification.NON_RETRYABLE,
      });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should bail on INSUFFICIENT_GAS", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("INSUFFICIENT_GAS"));

      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }),
      ).rejects.toMatchObject({
        success: false,
        classification: ErrorClassification.NON_RETRYABLE,
      });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should bail on TX_BAD_AUTH", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("TX_BAD_AUTH"));

      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }),
      ).rejects.toMatchObject({
        success: false,
        classification: ErrorClassification.NON_RETRYABLE,
      });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should classify unrecognized errors as unknown and stop", async () => {
      const fn = jest
        .fn()
        .mockRejectedValue(new Error("some completely new failure signature"));

      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }),
      ).rejects.toMatchObject({
        success: false,
        classification: ErrorClassification.UNKNOWN,
        attempts: 1,
      });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry unknown errors when retryUnknown is enabled", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("novel transient edge case"))
        .mockResolvedValueOnce("success");

      const result = await withRetry(fn, {
        maxRetries: 2,
        baseDelayMs: 10,
        retryUnknown: true,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("max retries exceeded", () => {
    it("should throw MAX_RETRIES_EXCEEDED after exhausting retries", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("NETWORK_ERROR"));

      await expect(
        withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }),
      ).rejects.toMatchObject({
        success: false,
        maxRetriesExceeded: true,
        attempts: 3,
        retries: 2,
      });

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should call onMaxRetries callback when max retries exceeded", async () => {
      const onMaxRetries = jest.fn();
      const error = new Error("TIMEOUT");
      const fn = jest.fn().mockRejectedValue(error);

      await expect(
        withRetry(fn, {
          maxRetries: 2,
          baseDelayMs: 10,
          onMaxRetries,
        }),
      ).rejects.toBeDefined();

      expect(onMaxRetries).toHaveBeenCalledTimes(1);
      expect(onMaxRetries).toHaveBeenCalledWith(error, 3, expect.any(Object));
    });
  });

  describe("retry callbacks", () => {
    it("should call onRetry callback on each retry", async () => {
      const onRetry = jest.fn();
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("TIMEOUT"))
        .mockRejectedValueOnce(new Error("RATE_LIMITED"))
        .mockResolvedValueOnce("success");

      await withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 10,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        expect.any(Error),
        1,
        expect.any(Number),
        expect.any(Object),
      );
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        expect.any(Error),
        2,
        expect.any(Number),
        expect.any(Object),
      );
    });
  });

  describe("exponential backoff", () => {
    it("should increase delay exponentially", async () => {
      const delays = [];
      const onRetry = jest.fn((_, attempt, delay) => {
        delays.push({ attempt, delay });
      });

      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("TIMEOUT"))
        .mockRejectedValueOnce(new Error("TIMEOUT"))
        .mockRejectedValueOnce(new Error("TIMEOUT"))
        .mockResolvedValueOnce("success");

      await withRetry(fn, {
        maxRetries: 4,
        baseDelayMs: 100,
        maxDelayMs: 10000,
        onRetry,
      });

      // Delays should be increasing (with jitter)
      expect(delays[0].delay).toBeGreaterThanOrEqual(100);
      expect(delays[1].delay).toBeGreaterThanOrEqual(200);
      expect(delays[2].delay).toBeGreaterThanOrEqual(400);
    });

    it("should cap delay at maxDelayMs", async () => {
      const delays = [];
      const onRetry = jest.fn((_, attempt, delay) => {
        delays.push(delay);
      });

      const fn = jest.fn().mockRejectedValue(new Error("TIMEOUT"));

      await expect(
        withRetry(fn, {
          maxRetries: 4,
          baseDelayMs: 10,
          maxDelayMs: 20,
          onRetry,
        }),
      ).rejects.toBeDefined();

      // All delays should be capped at maxDelayMs + jitter
      delays.forEach((delay) => {
        expect(delay).toBeLessThanOrEqual(20 + 10); // maxDelayMs + baseDelayMs (jitter)
      });
    });
  });

  describe("network error detection", () => {
    it("should retry on timeout message", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockResolvedValueOnce("success");

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on network error message", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("Network error occurred"))
        .mockResolvedValueOnce("success");

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on ECONNREFUSED", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce("success");

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on fetch failed", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce("success");

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("environment variable defaults", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should use MAX_RETRIES from environment", async () => {
      process.env.MAX_RETRIES = "5";

      // Need to re-import to pick up new env var
      jest.resetModules();
      const { withRetry: withRetryFresh } = require("../src/retry.js");

      const fn = jest.fn().mockRejectedValue(new Error("TIMEOUT"));

      await expect(
        withRetryFresh(fn, { baseDelayMs: 10 }),
      ).rejects.toMatchObject({ attempts: 6 }); // 5 retries + 1 initial

      expect(fn).toHaveBeenCalledTimes(6);
    });
  });
});

describe("retry (legacy function)", () => {
  it("should work with legacy retry interface", async () => {
    const fn = jest.fn().mockResolvedValue("success");

    const result = await retry(fn, 3, 10);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry with legacy interface", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("TIMEOUT"))
      .mockResolvedValueOnce("success");

    const result = await retry(fn, 3, 10);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("isRetryableError", () => {
  it("should return true for retryable errors", () => {
    expect(isRetryableError(new Error("TIMEOUT"))).toBe(true);
    expect(isRetryableError(new Error("NETWORK_ERROR"))).toBe(true);
    expect(isRetryableError(new Error("RATE_LIMITED"))).toBe(true);
  });

  it("should return false for non-retryable errors", () => {
    expect(isRetryableError(new Error("INVALID_ARGS"))).toBe(false);
    expect(isRetryableError(new Error("CONTRACT_PANIC"))).toBe(false);
    expect(isRetryableError(new Error("INSUFFICIENT_GAS"))).toBe(false);
  });

  it("should return false for duplicate errors", () => {
    expect(isRetryableError(new Error("DUPLICATE_TRANSACTION"))).toBe(false);
  });
});

describe("isDuplicateTransactionError", () => {
  it("should return true for duplicate errors", () => {
    expect(
      isDuplicateTransactionError(new Error("DUPLICATE_TRANSACTION")),
    ).toBe(true);
    expect(isDuplicateTransactionError({ code: "TX_ALREADY_IN_LEDGER" })).toBe(
      true,
    );
  });

  it("should return false for non-duplicate errors", () => {
    expect(isDuplicateTransactionError(new Error("TIMEOUT"))).toBe(false);
    expect(isDuplicateTransactionError(new Error("INVALID_ARGS"))).toBe(false);
  });
});

describe("ErrorClassification", () => {
  it("should have correct values", () => {
    expect(ErrorClassification.RETRYABLE).toBe("retryable");
    expect(ErrorClassification.NON_RETRYABLE).toBe("non_retryable");
    expect(ErrorClassification.DUPLICATE).toBe("duplicate");
    expect(ErrorClassification.UNKNOWN).toBe("unknown");
  });
});

describe("extractErrorCode", () => {
  it("should extract from errorCode and status fields", () => {
    expect(extractErrorCode({ errorCode: "NETWORK_ERROR" })).toBe(
      "NETWORK_ERROR",
    );
    expect(extractErrorCode({ status: "TIMEOUT" })).toBe("TIMEOUT");
  });

  it("should extract from resultXdr patterns", () => {
    const fakeXdr = {
      toString: () => "...txBadAuth...",
    };

    expect(extractErrorCode({ resultXdr: fakeXdr })).toBe("TXBADAUTH");
  });

  it("should return null for empty or unmatched payloads", () => {
    expect(extractErrorCode(null)).toBeNull();
    expect(extractErrorCode({})).toBeNull();
    expect(
      extractErrorCode({ resultXdr: { toString: () => "no known pattern" } }),
    ).toBeNull();
  });
});

describe("classifyError", () => {
  it("should classify null as unknown", () => {
    expect(classifyError(null)).toBe(ErrorClassification.UNKNOWN);
  });

  it("should classify retryable from status and message fallback", () => {
    expect(classifyError({ status: "NETWORK_ERROR" })).toBe(
      ErrorClassification.RETRYABLE,
    );
    expect(
      classifyError({ message: "temporarily unavailable upstream service" }),
    ).toBe(ErrorClassification.RETRYABLE);
  });

  it("should classify non-retryable from errorCode", () => {
    expect(classifyError({ errorCode: "VALIDATION_ERROR" })).toBe(
      ErrorClassification.NON_RETRYABLE,
    );
  });
});
