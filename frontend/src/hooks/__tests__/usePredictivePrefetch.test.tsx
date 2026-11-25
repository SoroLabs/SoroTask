import { renderHook, act } from "@testing-library/react";
import { usePredictivePrefetch } from "../usePredictivePrefetch";

const mockPathname = "/dashboard";
const mockPrefetchFn = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ prefetch: mockPrefetchFn }),
}));

describe("usePredictivePrefetch", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns initial state when disabled", () => {
    const { result } = renderHook(() =>
      usePredictivePrefetch({ enabled: false })
    );
    expect(result.current.isReady).toBe(false);
    expect(result.current.manager).toBeNull();
  });

  it("initializes when enabled", () => {
    const { result } = renderHook(() =>
      usePredictivePrefetch({ enabled: true })
    );
    expect(result.current.isReady).toBe(true);
    expect(result.current.manager).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("returns default metrics", () => {
    const { result } = renderHook(() =>
      usePredictivePrefetch({ enabled: true })
    );
    expect(result.current.metrics.totalPredictions).toBe(0);
    expect(result.current.metrics.successfulPrefetches).toBe(0);
  });

  it("provides empty predictions initially", () => {
    const { result } = renderHook(() =>
      usePredictivePrefetch({ enabled: true })
    );
    expect(result.current.predictions).toBeNull();
    expect(result.current.prefetchItems).toEqual([]);
  });

  it("provides reset function", () => {
    const { result } = renderHook(() =>
      usePredictivePrefetch({ enabled: true })
    );
    act(() => {
      result.current.reset();
    });
    expect(result.current.predictions).toBeNull();
    expect(result.current.prefetchItems).toEqual([]);
  });

  it("tracks session info", () => {
    const { result } = renderHook(() =>
      usePredictivePrefetch({ enabled: true })
    );
    expect(result.current.session).not.toBeNull();
    if (result.current.session) {
      expect(result.current.session.currentRoute).toBeDefined();
    }
  });
});
