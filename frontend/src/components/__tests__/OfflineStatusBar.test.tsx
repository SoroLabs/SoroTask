import { act, fireEvent, render, screen } from "@testing-library/react";
import { OfflineStatusBar } from "../OfflineStatusBar";

describe("OfflineStatusBar", () => {
  it("renders the offline state with queued count", () => {
    render(<OfflineStatusBar online={false} queuedCount={3} />);
    const bar = screen.getByTestId("offline-status-bar");
    expect(bar).toHaveAttribute("data-state", "offline");
    expect(bar.textContent).toContain("Offline");
    expect(bar.textContent).toContain("3 actions queued");
  });

  it("renders the resyncing state during a flush", () => {
    render(<OfflineStatusBar online={true} resyncing={true} queuedCount={2} />);
    const bar = screen.getByTestId("offline-status-bar");
    expect(bar).toHaveAttribute("data-state", "resyncing");
    expect(bar.textContent).toContain("Replaying 2 queued actions");
  });

  it("renders the online state and auto-hides after the timeout", () => {
    jest.useFakeTimers();
    try {
      const { rerender } = render(
        <OfflineStatusBar online={true} hideOnlineAfterMs={1000} />,
      );
      expect(screen.getByTestId("offline-status-bar")).toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(screen.queryByTestId("offline-status-bar")).toBeNull();

      // Going offline re-shows it.
      rerender(<OfflineStatusBar online={false} hideOnlineAfterMs={1000} />);
      expect(screen.getByTestId("offline-status-bar")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps the online state visible when there are still queued actions", () => {
    jest.useFakeTimers();
    try {
      render(
        <OfflineStatusBar
          online={true}
          queuedCount={1}
          hideOnlineAfterMs={500}
        />,
      );
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(screen.getByTestId("offline-status-bar")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("uses the singular form for exactly one queued action", () => {
    render(<OfflineStatusBar online={false} queuedCount={1} />);
    expect(screen.getByTestId("offline-status-bar").textContent).toContain(
      "1 action queued",
    );
  });

  it("exposes a retry control that reports back when clicked", () => {
    const onRetry = jest.fn();
    render(
      <OfflineStatusBar online={true} queuedCount={2} onRetry={onRetry} />,
    );

    const retry = screen.getByTestId("offline-status-retry");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("disables the retry control while a retry is in flight", () => {
    render(
      <OfflineStatusBar
        online={true}
        queuedCount={2}
        onRetry={jest.fn()}
        retrying
      />,
    );
    expect(screen.getByTestId("offline-status-retry")).toBeDisabled();
  });

  it("hides the retry control when nothing is queued and there is no error", () => {
    render(
      <OfflineStatusBar online={true} queuedCount={0} onRetry={jest.fn()} />,
    );
    expect(screen.queryByTestId("offline-status-retry")).toBeNull();
  });

  it("surfaces a sync error and stays visible instead of auto-hiding", () => {
    jest.useFakeTimers();
    try {
      render(
        <OfflineStatusBar
          online={true}
          error="indexer unreachable"
          hideOnlineAfterMs={500}
        />,
      );
      const bar = screen.getByTestId("offline-status-bar");
      expect(bar).toHaveAttribute("data-state", "error");
      expect(bar.textContent).toContain("Sync failed");
      expect(bar.textContent).toContain("indexer unreachable");

      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(screen.getByTestId("offline-status-bar")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
