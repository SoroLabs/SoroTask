/**
 * Tests for route + query prefetching (Issue #1254).
 */

import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useRoutePrefetcher } from "../useRoutePrefetcher";

const mockRouterPrefetch = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: mockRouterPrefetch }),
}));

function wrapperWithClient(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("useRoutePrefetcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prefetches the route bundle", () => {
    const client = makeClient();
    const { result } = renderHook(() => useRoutePrefetcher(), {
      wrapper: wrapperWithClient(client),
    });

    act(() => result.current.prefetchRoute("/analytics"));

    expect(mockRouterPrefetch).toHaveBeenCalledWith("/analytics");
  });

  it("prefetches the route's query data too", async () => {
    // Bundle-only prefetching still shows a spinner on arrival, which is the
    // delay the issue is about.
    const client = makeClient();
    const queryFn = jest.fn().mockResolvedValue({ total: 42 });

    const { result } = renderHook(
      () =>
        useRoutePrefetcher({
          resolveQueries: (route) =>
            route === "/analytics"
              ? [{ queryKey: ["analytics", "summary"], queryFn }]
              : [],
        }),
      { wrapper: wrapperWithClient(client) },
    );

    await act(async () => {
      result.current.prefetchRoute("/analytics");
      await Promise.resolve();
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["analytics", "summary"])).toEqual({ total: 42 });
  });

  it("does not prefetch the same route twice inside the dedupe window", () => {
    const client = makeClient();
    const { result } = renderHook(() => useRoutePrefetcher(), {
      wrapper: wrapperWithClient(client),
    });

    act(() => {
      result.current.prefetchRoute("/analytics");
      result.current.prefetchRoute("/analytics");
      result.current.prefetchRoute("/analytics");
    });

    expect(mockRouterPrefetch).toHaveBeenCalledTimes(1);
  });

  it("prefetches different routes independently", () => {
    const client = makeClient();
    const { result } = renderHook(() => useRoutePrefetcher(), {
      wrapper: wrapperWithClient(client),
    });

    act(() => {
      result.current.prefetchRoute("/analytics");
      result.current.prefetchRoute("/tasks");
    });

    expect(mockRouterPrefetch).toHaveBeenCalledTimes(2);
  });

  it("caps how many routes are prefetched at once", async () => {
    // Speculative work must not compete with requests the user is waiting on.
    const client = makeClient();
    const never = () => new Promise<unknown>(() => {});

    const { result } = renderHook(
      () =>
        useRoutePrefetcher({
          maxConcurrent: 2,
          resolveQueries: (route) => [{ queryKey: [route], queryFn: never }],
        }),
      { wrapper: wrapperWithClient(client) },
    );

    await act(async () => {
      result.current.prefetchRoute("/a");
      result.current.prefetchRoute("/b");
      result.current.prefetchRoute("/c");
    });

    expect(mockRouterPrefetch).toHaveBeenCalledTimes(2);
  });

  it("does nothing while disabled", () => {
    const client = makeClient();
    const { result } = renderHook(() => useRoutePrefetcher({ enabled: false }), {
      wrapper: wrapperWithClient(client),
    });

    act(() => result.current.prefetchRoute("/analytics"));

    expect(mockRouterPrefetch).not.toHaveBeenCalled();
  });

  it("ignores an empty route", () => {
    const client = makeClient();
    const { result } = renderHook(() => useRoutePrefetcher(), {
      wrapper: wrapperWithClient(client),
    });

    act(() => result.current.prefetchRoute(""));

    expect(mockRouterPrefetch).not.toHaveBeenCalled();
  });

  it("swallows a router prefetch failure", () => {
    // The user never asked for this request; a failure just means the real
    // navigation pays full price.
    mockRouterPrefetch.mockImplementationOnce(() => {
      throw new Error("route does not exist");
    });

    const client = makeClient();
    const { result } = renderHook(() => useRoutePrefetcher(), {
      wrapper: wrapperWithClient(client),
    });

    expect(() => act(() => result.current.prefetchRoute("/nope"))).not.toThrow();
  });

  it("still prefetches the bundle when a query rejects", async () => {
    // Each half is isolated so one failing does not skip the other.
    const client = makeClient();
    const queryFn = jest.fn().mockRejectedValue(new Error("offline"));

    const { result } = renderHook(
      () => useRoutePrefetcher({ resolveQueries: () => [{ queryKey: ["x"], queryFn }] }),
      { wrapper: wrapperWithClient(client) },
    );

    await act(async () => {
      result.current.prefetchRoute("/analytics");
      await Promise.resolve();
    });

    expect(mockRouterPrefetch).toHaveBeenCalledWith("/analytics");
  });

  it("works without a QueryClientProvider, prefetching the bundle only", () => {
    // Route prefetching must not become a hard dependency on React Query
    // being mounted.
    const { result } = renderHook(() => useRoutePrefetcher());

    expect(() => act(() => result.current.prefetchRoute("/analytics"))).not.toThrow();
    expect(mockRouterPrefetch).toHaveBeenCalledWith("/analytics");
  });

  it("re-prefetches a route after reset", () => {
    const client = makeClient();
    const { result } = renderHook(() => useRoutePrefetcher(), {
      wrapper: wrapperWithClient(client),
    });

    act(() => result.current.prefetchRoute("/analytics"));
    act(() => result.current.reset());
    act(() => result.current.prefetchRoute("/analytics"));

    expect(mockRouterPrefetch).toHaveBeenCalledTimes(2);
  });

  it("reports how many routes it has prefetched", () => {
    const client = makeClient();
    const { result } = renderHook(() => useRoutePrefetcher(), {
      wrapper: wrapperWithClient(client),
    });

    act(() => {
      result.current.prefetchRoute("/a");
      result.current.prefetchRoute("/b");
      result.current.prefetchRoute("/a");
    });

    expect(result.current.prefetchedCount()).toBe(2);
  });
});
