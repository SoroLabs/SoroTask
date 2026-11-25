import { StaleWhileRevalidateCache } from "../StaleWhileRevalidateCache";

// Mock sentry
jest.mock("../../errors/sentry", () => ({
  captureSentryException: jest.fn(),
}));

describe("StaleWhileRevalidateCache", () => {
  let cache: StaleWhileRevalidateCache;

  beforeEach(() => {
    cache = new StaleWhileRevalidateCache({ enableLogging: false, maxRetries: 0, retryDelayMs: 0 });
  });

  it("stores and retrieves data", () => {
    cache.set(["key"], { value: "test" });
    expect(cache.get(["key"])).toEqual({ value: "test" });
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get(["missing"])).toBeUndefined();
  });

  it("tracks cache hits", () => {
    cache.set(["key"], { value: "test" });
    cache.get(["key"]);
    expect(cache.getMetrics().hits).toBe(1);
  });

  it("tracks cache misses", () => {
    cache.get(["missing"]);
    expect(cache.getMetrics().misses).toBe(1);
  });

  it("uses fallback on network error", async () => {
    cache.setFallback(["key"], { fallback: true });
    const fetchFn = jest.fn().mockRejectedValue(new Error("Failed"));
    const result = await cache.fetch(["key"], fetchFn, "test");
    expect(result.source).toBe("fallback");
    expect(result.data).toEqual({ fallback: true });
  });

  it("fetches from network when cache empty", async () => {
    const fetchFn = jest.fn().mockResolvedValue({ fresh: true });
    const result = await cache.fetch(["key"], fetchFn, "test");
    expect(result.source).toBe("network");
    expect(result.data).toEqual({ fresh: true });
  });

  it("clears cache entries", () => {
    cache.set(["key1"], { v1: 1 });
    cache.set(["key2"], { v2: 2 });
    cache.clear(["key1"]);
    expect(cache.get(["key1"])).toBeUndefined();
    expect(cache.get(["key2"])).toEqual({ v2: 2 });
  });

  it("clears all cache", () => {
    cache.set(["key1"], { v1: 1 });
    cache.set(["key2"], { v2: 2 });
    cache.clear();
    expect(cache.get(["key1"])).toBeUndefined();
    expect(cache.get(["key2"])).toBeUndefined();
  });
});