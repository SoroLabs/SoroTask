import { act, render, screen } from "@testing-library/react";
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
    render(
      <OfflineStatusBar online={true} resyncing={true} queuedCount={2} />,
    );
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
      rerender(
        <OfflineStatusBar online={false} hideOnlineAfterMs={1000} />,
      );
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
});
