import {
  getWebSocketUrl,
  mergeRecords,
  parseHistoryResponse,
  parseSocketMessage,
} from "../feed";

describe("financial analytics feed", () => {
  it("parses and sorts valid gas history records", () => {
    const records = parseHistoryResponse(
      [
        { timestamp: "2026-10-17T01:00:00Z", open: 2, high: 3, low: 1, close: 2.5 },
        { timestamp: 1_792_200_000, open: 1, high: 2, low: 0.5, close: 1.5 },
      ],
      "gas",
    );
    expect(records).toHaveLength(2);
    expect(records[1].timestamp).toBe("2026-10-17T01:20:00.000Z");
  });

  it("validates required APY fields and numeric values", () => {
    expect(
      parseHistoryResponse(
        { records: [{ timestamp: "2026-10-17T00:00:00Z", apyPercent: 8.25 }] },
        "yield",
      ),
    ).toEqual([{ timestamp: "2026-10-17T00:00:00.000Z", apyPercent: 8.25 }]);
    expect(() =>
      parseHistoryResponse([{ timestamp: "2026-10-17", apyPercent: -1 }], "yield"),
    ).toThrow("apyPercent must be a finite non-negative number");
  });

  it("rejects malformed or inconsistent OHLC and depth values", () => {
    expect(() =>
      parseHistoryResponse(
        [{ timestamp: "2026-10-17", open: 3, high: 2, low: 1, close: 3 }],
        "gas",
      ),
    ).toThrow("inconsistent OHLC values");
    expect(() =>
      parseHistoryResponse(
        [{ timestamp: "2026-10-17", open: 1, high: 2, low: 0.5, close: 1, depth: "bad" }],
        "gas",
      ),
    ).toThrow("depth must be an array");
  });

  it("merges tick updates by timestamp and keeps records ordered", () => {
    const prior = parseHistoryResponse(
      [
        { timestamp: "2026-10-17T00:00:00Z", apyPercent: 2 },
        { timestamp: "2026-10-17T02:00:00Z", apyPercent: 4 },
      ],
      "yield",
    );
    const incoming = parseHistoryResponse(
      [
        { timestamp: "2026-10-17T01:00:00Z", apyPercent: 3 },
        { timestamp: "2026-10-17T02:00:00Z", apyPercent: 5 },
      ],
      "yield",
    );
    expect(mergeRecords(prior, incoming)).toEqual([
      { timestamp: "2026-10-17T00:00:00.000Z", apyPercent: 2 },
      { timestamp: "2026-10-17T01:00:00.000Z", apyPercent: 3 },
      { timestamp: "2026-10-17T02:00:00.000Z", apyPercent: 5 },
    ]);
  });

  it("accepts typed WebSocket ticks and ignores heartbeats", () => {
    expect(
      parseSocketMessage(
        { type: "gas", data: { timestamp: "2026-10-17", open: 1, high: 2, low: 0.5, close: 1 } },
        "gas",
      ),
    ).toMatchObject({ open: 1, close: 1 });
    expect(parseSocketMessage({ type: "heartbeat" }, "gas")).toBeNull();
    expect(() => parseSocketMessage({ type: "yield", data: {} }, "gas")).toThrow(
      'Unexpected analytics WebSocket message type "yield".',
    );
  });

  it("requires WebSocket URLs to use ws or wss", () => {
    const previous = process.env.NEXT_PUBLIC_ANALYTICS_WS_URL;
    process.env.NEXT_PUBLIC_ANALYTICS_WS_URL = "https://example.org/stream";
    expect(() => getWebSocketUrl("gas")).toThrow("must use ws:// or wss://");
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ANALYTICS_WS_URL;
    else process.env.NEXT_PUBLIC_ANALYTICS_WS_URL = previous;
  });

  it("selects the current series on the configured WebSocket URL", () => {
    const previous = process.env.NEXT_PUBLIC_ANALYTICS_WS_URL;
    process.env.NEXT_PUBLIC_ANALYTICS_WS_URL = "wss://example.org/stream?token=public";
    expect(getWebSocketUrl("yield")).toBe(
      "wss://example.org/stream?token=public&stream=yield",
    );
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ANALYTICS_WS_URL;
    else process.env.NEXT_PUBLIC_ANALYTICS_WS_URL = previous;
  });
});
