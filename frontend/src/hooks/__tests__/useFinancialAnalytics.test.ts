import { act, renderHook, waitFor } from "@testing-library/react";
import { useFinancialAnalytics } from "../useFinancialAnalytics";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = jest.fn();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }
}

const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
const socketDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
const previousSocketUrl = process.env.NEXT_PUBLIC_ANALYTICS_WS_URL;

describe("useFinancialAnalytics", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    process.env.NEXT_PUBLIC_ANALYTICS_WS_URL = "wss://analytics.example/stream";
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            timestamp: "2026-10-17T00:00:00Z",
            open: 0.1,
            high: 0.2,
            low: 0.08,
            close: 0.15,
          },
        ],
      }),
    });
  });

  afterAll(() => {
    if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    else Reflect.deleteProperty(globalThis, "fetch");
    if (socketDescriptor) Object.defineProperty(globalThis, "WebSocket", socketDescriptor);
    else Reflect.deleteProperty(globalThis, "WebSocket");
    if (previousSocketUrl === undefined) delete process.env.NEXT_PUBLIC_ANALYTICS_WS_URL;
    else process.env.NEXT_PUBLIC_ANALYTICS_WS_URL = previousSocketUrl;
  });

  it("loads history, merges live ticks and closes the socket on unmount", async () => {
    const { result, unmount } = renderHook(() => useFinancialAnalytics("gas"));

    await waitFor(() => expect(result.current.records).toHaveLength(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/analytics/gas-history",
      expect.objectContaining({ cache: "no-store" }),
    );
    const socket = MockWebSocket.instances[0];
    expect(new URL(socket.url).searchParams.get("stream")).toBe("gas");

    act(() => socket.onopen?.());
    act(() =>
      socket.onmessage?.({
        data: JSON.stringify({
          type: "gas",
          data: {
            timestamp: "2026-10-17T00:00:00Z",
            open: 0.1,
            high: 0.3,
            low: 0.08,
            close: 0.25,
          },
        }),
      } as MessageEvent),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(result.current.records).toHaveLength(1);
    await waitFor(() => expect(result.current.records[0]).toMatchObject({ close: 0.25 }));

    unmount();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("exposes HTTP failures instead of substituting sample records", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    const { result } = renderHook(() => useFinancialAnalytics("yield"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.records).toEqual([]);
    expect(result.current.error).toBe("Analytics history request failed (503).");
  });
});
