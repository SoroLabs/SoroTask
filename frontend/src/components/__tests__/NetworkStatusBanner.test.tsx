import { act, fireEvent, render, screen } from "@testing-library/react";
import { NetworkStatusBanner, type NetworkStatusBannerProps } from "../NetworkStatusBanner";

function renderBanner(props: Partial<NetworkStatusBannerProps> = {}) {
  return render(<NetworkStatusBanner online {...props} />);
}

describe("NetworkStatusBanner", () => {
  describe("online state", () => {
    it("renders the healthy state", () => {
      renderBanner();

      expect(screen.getByTestId("network-status-banner")).toHaveAttribute("data-state", "online");
      expect(screen.getByText("Online")).toBeInTheDocument();
    });

    it("reports how many actions are still queued", () => {
      renderBanner({ queuedCount: 3 });

      expect(screen.getByText("Online")).toBeInTheDocument();
      expect(screen.getByText("3 actions still queued.")).toBeInTheDocument();
    });

    it("uses the singular form for a single queued action", () => {
      renderBanner({ queuedCount: 1 });

      expect(screen.getByText("1 action still queued.")).toBeInTheDocument();
    });

    it("auto-hides after the configured delay", () => {
      jest.useFakeTimers();
      renderBanner({ hideOnlineAfterMs: 1000 });

      expect(screen.getByTestId("network-status-banner")).toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.queryByTestId("network-status-banner")).not.toBeInTheDocument();
      jest.useRealTimers();
    });

    it("stays pinned when the auto-hide delay is zero", () => {
      jest.useFakeTimers();
      renderBanner({ hideOnlineAfterMs: 0 });

      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(screen.getByTestId("network-status-banner")).toBeInTheDocument();
      jest.useRealTimers();
    });
  });

  describe("offline state", () => {
    it("renders the offline state and does not auto-hide", () => {
      jest.useFakeTimers();
      renderBanner({ online: false, queuedCount: 2 });

      expect(screen.getByTestId("network-status-banner")).toHaveAttribute("data-state", "offline");
      expect(screen.getByText("Offline")).toBeInTheDocument();
      expect(
        screen.getByText("2 actions queued — will run when you're back online."),
      ).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(screen.getByTestId("network-status-banner")).toBeInTheDocument();
      jest.useRealTimers();
    });

    it("explains that changes are queued when nothing is pending yet", () => {
      renderBanner({ online: false, queuedCount: 0 });

      expect(
        screen.getByText("You can still browse cached content. Changes will be queued."),
      ).toBeInTheDocument();
    });
  });

  describe("resyncing state", () => {
    it("renders the replaying state", () => {
      renderBanner({ resyncing: true, queuedCount: 4 });

      expect(screen.getByTestId("network-status-banner")).toHaveAttribute("data-state", "resyncing");
      expect(screen.getByText("Resyncing")).toBeInTheDocument();
      expect(screen.getByText("Replaying 4 queued actions…")).toBeInTheDocument();
    });

    it("falls back to a generic message when the queue is empty", () => {
      renderBanner({ resyncing: true });

      expect(screen.getByText("Catching up after reconnect…")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders the sync failure and keeps the queued work visible", () => {
      renderBanner({ error: "RPC timeout" });

      expect(screen.getByTestId("network-status-banner")).toHaveAttribute("data-state", "error");
      expect(screen.getByText("Sync failed")).toBeInTheDocument();
      expect(screen.getByText("RPC timeout Your changes are still queued.")).toBeInTheDocument();
    });

    it("retries on click", () => {
      const onRetry = jest.fn();
      renderBanner({ error: "RPC timeout", onRetry });

      fireEvent.click(screen.getByTestId("network-status-retry"));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("disables the retry button while a retry is in flight", () => {
      renderBanner({ error: "RPC timeout", onRetry: jest.fn(), retrying: true });

      const button = screen.getByTestId("network-status-retry");
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent("Retrying…");
    });
  });

  describe("rollback state", () => {
    it("takes priority over every other state", () => {
      renderBanner({ online: false, error: "RPC timeout", rollbackActive: true });

      expect(screen.getByTestId("network-status-banner")).toHaveAttribute("data-state", "rollback");
      expect(screen.getByText("Changes reverted")).toBeInTheDocument();
    });

    it("explains what failed and that nothing was saved", () => {
      renderBanner({ rollbackActive: true, rollbackReason: "Insufficient balance" });

      expect(
        screen.getByText(
          "Your last change could not be applied: Insufficient balance. Nothing was saved.",
        ),
      ).toBeInTheDocument();
    });

    it("does not crash when no reason is supplied", () => {
      renderBanner({ rollbackActive: true });

      expect(
        screen.getByText("Your last change could not be applied. Nothing was saved."),
      ).toBeInTheDocument();
    });
  });

  describe("retry affordance", () => {
    it("is hidden in the healthy state with nothing queued", () => {
      renderBanner({ onRetry: jest.fn() });

      expect(screen.queryByTestId("network-status-retry")).not.toBeInTheDocument();
    });

    it("is hidden when no retry handler is supplied", () => {
      renderBanner({ online: false, queuedCount: 2 });

      expect(screen.queryByTestId("network-status-retry")).not.toBeInTheDocument();
    });

    it("is shown while offline with queued work", () => {
      const onRetry = jest.fn();
      renderBanner({ online: false, queuedCount: 2, onRetry });

      fireEvent.click(screen.getByTestId("network-status-retry"));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("is shown in the healthy state when work is still queued", () => {
      renderBanner({ queuedCount: 1, onRetry: jest.fn() });

      expect(screen.getByTestId("network-status-retry")).toBeInTheDocument();
    });
  });
});