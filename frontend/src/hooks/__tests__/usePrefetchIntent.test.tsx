/**
 * Tests for hover/focus/touch intent detection (Issue #1254).
 */

import { act, renderHook } from "@testing-library/react";

import { usePrefetchIntent, DEFAULT_INTENT_DELAY_MS } from "../usePrefetchIntent";

describe("usePrefetchIntent", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("does not fire immediately on hover", () => {
    // Firing on mouseenter prefetches every link the cursor crosses on its way
    // somewhere else.
    const onIntent = jest.fn();
    const { result } = renderHook(() => usePrefetchIntent({ onIntent }));

    act(() => result.current.onMouseEnter());

    expect(onIntent).not.toHaveBeenCalled();
  });

  it("fires once the dwell delay elapses", () => {
    const onIntent = jest.fn();
    const { result } = renderHook(() => usePrefetchIntent({ onIntent }));

    act(() => result.current.onMouseEnter());
    act(() => {
      jest.advanceTimersByTime(DEFAULT_INTENT_DELAY_MS);
    });

    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it("cancels when the pointer leaves before the delay", () => {
    // The pointer was passing through — exactly what the delay filters out.
    const onIntent = jest.fn();
    const { result } = renderHook(() => usePrefetchIntent({ onIntent }));

    act(() => result.current.onMouseEnter());
    act(() => {
      jest.advanceTimersByTime(DEFAULT_INTENT_DELAY_MS - 10);
    });
    act(() => result.current.onMouseLeave());
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(onIntent).not.toHaveBeenCalled();
  });

  it("honours a custom delay", () => {
    const onIntent = jest.fn();
    const { result } = renderHook(() => usePrefetchIntent({ onIntent, delayMs: 500 }));

    act(() => result.current.onMouseEnter());
    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(onIntent).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it("fires immediately on keyboard focus", () => {
    // Tabbing to a control is deliberate in a way a cursor crossing it is not,
    // and a keyboard user would otherwise never benefit from prefetching.
    const onIntent = jest.fn();
    const { result } = renderHook(() => usePrefetchIntent({ onIntent }));

    act(() => result.current.onFocus());

    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it("fires immediately on touch", () => {
    // touchstart already is the commitment; the window before click is the
    // entire budget available.
    const onIntent = jest.fn();
    const { result } = renderHook(() => usePrefetchIntent({ onIntent }));

    act(() => result.current.onTouchStart());

    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it("fires only once for repeated hovers inside the re-arm window", () => {
    const onIntent = jest.fn();
    const { result } = renderHook(() => usePrefetchIntent({ onIntent }));

    for (let i = 0; i < 3; i += 1) {
      act(() => result.current.onMouseEnter());
      act(() => {
        jest.advanceTimersByTime(DEFAULT_INTENT_DELAY_MS);
      });
      act(() => result.current.onMouseLeave());
    }

    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it("re-arms after the re-arm window so a later visit gets fresh data", () => {
    const onIntent = jest.fn();
    const { result } = renderHook(() =>
      usePrefetchIntent({ onIntent, rearmAfterMs: 1_000 }),
    );

    act(() => result.current.onFocus());
    expect(onIntent).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1_500);
    });
    act(() => result.current.onFocus());

    expect(onIntent).toHaveBeenCalledTimes(2);
  });

  it("never re-arms when rearmAfterMs is 0", () => {
    const onIntent = jest.fn();
    const { result } = renderHook(() => usePrefetchIntent({ onIntent, rearmAfterMs: 0 }));

    act(() => result.current.onFocus());
    act(() => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });
    act(() => result.current.onFocus());

    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", () => {
    const onIntent = jest.fn();
    const { result } = renderHook(() => usePrefetchIntent({ onIntent, enabled: false }));

    act(() => result.current.onMouseEnter());
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    act(() => result.current.onFocus());
    act(() => result.current.onTouchStart());

    expect(onIntent).not.toHaveBeenCalled();
  });

  it("cancels a pending timer on unmount", () => {
    // An unmounted row must not fire a prefetch for a page the user left.
    const onIntent = jest.fn();
    const { result, unmount } = renderHook(() => usePrefetchIntent({ onIntent }));

    act(() => result.current.onMouseEnter());
    unmount();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(onIntent).not.toHaveBeenCalled();
  });

  it("calls the latest callback without re-creating handlers", () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = renderHook(
      ({ onIntent }) => usePrefetchIntent({ onIntent }),
      { initialProps: { onIntent: first } },
    );

    const handlers = result.current;
    rerender({ onIntent: second });

    // Same handler identity — a caller spreading these onto a list row does
    // not re-render the whole list when its closure changes.
    expect(result.current.onMouseEnter).toBe(handlers.onMouseEnter);

    act(() => result.current.onFocus());

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
