import { render, screen, fireEvent } from "@testing-library/react";
import { ShortcutManagerDashboard } from "../ShortcutManagerDashboard";
import { createShortcutManager } from "@/src/lib/keyboard/shortcutManager";

jest.mock("@/src/lib/keyboard/shortcutManager", () => ({
  createShortcutManager: jest.fn(),
}));

describe("ShortcutManagerDashboard", () => {
  const destroy = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows worker mode when manager is worker-backed", () => {
    (createShortcutManager as jest.Mock).mockReturnValue({
      isWorkerBacked: true,
      processKeyboardEvent: jest.fn(),
      destroy,
    });

    render(
      <ShortcutManagerDashboard
        shortcuts={[{ id: "open", combo: "ctrl+k", description: "Open" }]}
      />,
    );

    expect(screen.getByTestId("shortcut-dashboard-mode")).toHaveTextContent(
      "Worker active",
    );
  });

  it("falls back to main-thread mode label", () => {
    (createShortcutManager as jest.Mock).mockReturnValue({
      isWorkerBacked: false,
      processKeyboardEvent: jest.fn(),
      destroy,
    });

    render(
      <ShortcutManagerDashboard
        shortcuts={[{ id: "save", combo: "ctrl+s", description: "Save" }]}
      />,
    );

    expect(screen.getByTestId("shortcut-dashboard-mode")).toHaveTextContent(
      "Main-thread fallback",
    );
  });

  it("wires keyboard events to manager", () => {
    const processKeyboardEvent = jest.fn();
    (createShortcutManager as jest.Mock).mockReturnValue({
      isWorkerBacked: true,
      processKeyboardEvent,
      destroy,
    });

    render(
      <ShortcutManagerDashboard
        shortcuts={[{ id: "open", combo: "ctrl+k", description: "Open" }]}
      />,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(processKeyboardEvent).toHaveBeenCalledWith(
      expect.objectContaining({ key: "k", ctrlKey: true }),
    );
  });

  it("renders reported manager errors", () => {
    (createShortcutManager as jest.Mock).mockImplementation(({ onError }) => {
      onError(new Error("worker unavailable"));
      return {
        isWorkerBacked: false,
        processKeyboardEvent: jest.fn(),
        destroy,
      };
    });

    render(
      <ShortcutManagerDashboard
        shortcuts={[{ id: "save", combo: "ctrl+s", description: "Save" }]}
      />,
    );

    expect(screen.getByTestId("shortcut-dashboard-errors")).toHaveTextContent(
      "worker unavailable",
    );
  });

  it("updates last-triggered status from manager callback", () => {
    (createShortcutManager as jest.Mock).mockImplementation(({ onShortcut }) => ({
      isWorkerBacked: true,
      processKeyboardEvent: () => {
        onShortcut({
          id: "open",
          combo: "ctrl+k",
          description: "Open",
        });
      },
      destroy,
    }));

    render(
      <ShortcutManagerDashboard
        shortcuts={[{ id: "open", combo: "ctrl+k", description: "Open" }]}
      />,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByTestId("shortcut-last-triggered")).toHaveTextContent(
      "Open (ctrl+k)",
    );
  });

  it("cleans up manager on unmount", () => {
    (createShortcutManager as jest.Mock).mockReturnValue({
      isWorkerBacked: true,
      processKeyboardEvent: jest.fn(),
      destroy,
    });

    const { unmount } = render(
      <ShortcutManagerDashboard
        shortcuts={[{ id: "open", combo: "ctrl+k", description: "Open" }]}
      />,
    );

    unmount();
    expect(destroy).toHaveBeenCalled();
  });
});
