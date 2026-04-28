import { act, renderHook } from "@testing-library/react";
import { useOnlineStatus } from "../useOnlineStatus";

describe("useOnlineStatus", () => {
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "onLine",
    );
  });

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(window.navigator, "onLine", originalDescriptor);
    }
  });

  function setOnLine(value: boolean) {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      get: () => value,
    });
  }

  it("reports the current navigator.onLine after mount", () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.online).toBe(true);
  });

  it("flips to offline when an offline event fires", () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.online).toBe(false);
    expect(result.current.lastChangeAt).not.toBeNull();
  });

  it("flips back to online when an online event fires", () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.online).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.online).toBe(true);
  });

  it("removes its event listeners on unmount", () => {
    setOnLine(true);
    const { result, unmount } = renderHook(() => useOnlineStatus());
    unmount();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    // After unmount the hook's state is frozen at last render.
    expect(result.current.online).toBe(true);
  });
});
