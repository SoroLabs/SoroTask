/**
 * WalletContext.test.tsx
 *
 * Tests for WalletProvider and useWallet hook.
 * Mocks app/lib/wallet so no real Freighter extension is needed.
 */

import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider, useWallet } from "@/app/context/WalletContext";
import { WalletConnectionError } from "@/app/lib/wallet";

// ---------------------------------------------------------------------------
// Mock app/lib/wallet
// ---------------------------------------------------------------------------

jest.mock("@/app/lib/wallet", () => ({
  connectWallet: jest.fn(),
  restoreSession: jest.fn(),
  watchWalletChanges: jest.fn(() => jest.fn()), // returns a stop() fn
  truncateAddress: jest.fn((addr: string) => addr.slice(0, 5) + "..." + addr.slice(-4)),
  WalletConnectionError: class WalletConnectionError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "WalletConnectionError";
    }
  },
  EXPECTED_NETWORK_PASSPHRASE: "Test SDF Future Network ; October 2022",
}));

import {
  connectWallet,
  restoreSession,
  watchWalletChanges,
} from "@/app/lib/wallet";

const mockConnect = connectWallet as jest.Mock;
const mockRestore = restoreSession as jest.Mock;
const mockWatch = watchWalletChanges as jest.Mock;

const MOCK_SESSION = {
  address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRS",
  network: {
    network: "FUTURENET",
    networkUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
  },
};

// ---------------------------------------------------------------------------
// Helper: consumer component
// ---------------------------------------------------------------------------

function TestConsumer() {
  const { status, session, errorCode, errorMessage, connect, disconnect, clearError } =
    useWallet();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="address">{session?.address ?? "none"}</p>
      <p data-testid="network">{session?.network.network ?? "none"}</p>
      <p data-testid="error-code">{errorCode ?? "none"}</p>
      <p data-testid="error-message">{errorMessage ?? "none"}</p>
      <button onClick={connect}>connect</button>
      <button onClick={disconnect}>disconnect</button>
      <button onClick={clearError}>clear-error</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <WalletProvider>
      <TestConsumer />
    </WalletProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWatch.mockReturnValue(jest.fn()); // default: returns a no-op stop fn
});

// ---------------------------------------------------------------------------
// Session restore on mount
// ---------------------------------------------------------------------------

describe("session restore on mount", () => {
  it("restores an existing session silently", async () => {
    mockRestore.mockResolvedValue(MOCK_SESSION);

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    expect(screen.getByTestId("address").textContent).toBe(MOCK_SESSION.address);
    expect(screen.getByTestId("network").textContent).toBe("FUTURENET");
  });

  it("sets status to disconnected when no prior session exists", async () => {
    mockRestore.mockResolvedValue(null);

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
    expect(screen.getByTestId("address").textContent).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// connect action
// ---------------------------------------------------------------------------

describe("connect action", () => {
  it("transitions to connected on success", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockResolvedValue(MOCK_SESSION);

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("status").textContent).toBe("connected");
    expect(screen.getByTestId("address").textContent).toBe(MOCK_SESSION.address);
  });

  it("sets error state when connection fails with NOT_INSTALLED", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockRejectedValue(
      new WalletConnectionError("NOT_INSTALLED", "Freighter is not installed."),
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(screen.getByTestId("error-code").textContent).toBe("NOT_INSTALLED");
  });

  it("sets error state when user rejects the popup", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockRejectedValue(
      new WalletConnectionError("USER_REJECTED", "User rejected."),
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(screen.getByTestId("error-code").textContent).toBe("USER_REJECTED");
  });

  it("sets WRONG_NETWORK error when wallet is on wrong network", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockRejectedValue(
      new WalletConnectionError("WRONG_NETWORK", "Switch to Futurenet."),
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("error-code").textContent).toBe("WRONG_NETWORK");
    expect(screen.getByTestId("error-message").textContent).toBe("Switch to Futurenet.");
  });
});

// ---------------------------------------------------------------------------
// disconnect action
// ---------------------------------------------------------------------------

describe("disconnect action", () => {
  it("clears session and sets status to disconnected", async () => {
    mockRestore.mockResolvedValue(MOCK_SESSION);

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("connected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("disconnect"));
    });

    expect(screen.getByTestId("status").textContent).toBe("disconnected");
    expect(screen.getByTestId("address").textContent).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// clearError action
// ---------------------------------------------------------------------------

describe("clearError action", () => {
  it("resets error state back to disconnected", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockRejectedValue(
      new WalletConnectionError("UNKNOWN", "Something went wrong."),
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });
    expect(screen.getByTestId("status").textContent).toBe("error");

    await act(async () => {
      await userEvent.click(screen.getByText("clear-error"));
    });

    expect(screen.getByTestId("status").textContent).toBe("disconnected");
    expect(screen.getByTestId("error-code").textContent).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// useWallet outside provider
// ---------------------------------------------------------------------------

describe("useWallet outside provider", () => {
  it("throws a descriptive error", () => {
    // Suppress React's error boundary console output
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<TestConsumer />)).toThrow(
      "useWallet must be used inside <WalletProvider>.",
    );

    spy.mockRestore();
  });
});
