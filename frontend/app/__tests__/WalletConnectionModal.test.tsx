/**
 * WalletConnectionModal.test.tsx
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider, useWallet } from "@/app/context/WalletContext";
import { WalletConnectionModal } from "@/app/components/WalletConnectionModal";
import { WalletConnectionError } from "@/app/lib/wallet";

jest.mock("@/app/lib/wallet", () => ({
  connectWallet: jest.fn(),
  restoreSession: jest.fn(),
  watchWalletChanges: jest.fn(() => jest.fn()),
  isFreighterInstalled: jest.fn(),
  truncateAddress: jest.fn(
    (addr: string) => addr.slice(0, 5) + "..." + addr.slice(-4),
  ),
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
  isFreighterInstalled,
} from "@/app/lib/wallet";

const mockConnect = connectWallet as jest.Mock;
const mockRestore = restoreSession as jest.Mock;
const mockIsInstalled = isFreighterInstalled as jest.Mock;

const MOCK_SESSION = {
  address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRS",
  network: {
    network: "FUTURENET",
    networkUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
  },
};

function ModalHost({ open = true }: { open?: boolean }) {
  const { closeConnectModal } = useWallet();
  return (
    <WalletConnectionModal open={open} onClose={closeConnectModal} />
  );
}

function renderModal() {
  return render(
    <WalletProvider>
      <ModalHost />
    </WalletProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRestore.mockResolvedValue(null);
  mockIsInstalled.mockResolvedValue(true);
});

describe("WalletConnectionModal", () => {
  it("shows disconnected state with connect action when Freighter is installed", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("wallet-state-disconnected")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /connect with freighter/i }),
    ).toBeInTheDocument();
  });

  it("shows not-installed degradation when Freighter is missing", async () => {
    mockIsInstalled.mockResolvedValue(false);
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("wallet-state-not-installed")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /install freighter/i })).toHaveAttribute(
      "href",
      "https://www.freighter.app/",
    );
    expect(
      screen.getByRole("button", { name: /continue without wallet/i }),
    ).toBeInTheDocument();
  });

  it("shows connecting state during connection", async () => {
    mockConnect.mockImplementation(
      () => new Promise(() => {}),
    );

    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("wallet-state-disconnected")).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: /connect with freighter/i }),
    );

    expect(screen.getByTestId("wallet-state-connecting")).toBeInTheDocument();
    expect(screen.getByText(/waiting for freighter/i)).toBeInTheDocument();
  });

  it("shows error state with retry when connection fails", async () => {
    mockConnect.mockRejectedValue(
      new WalletConnectionError("USER_REJECTED", "User rejected the request."),
    );

    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("wallet-state-disconnected")).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: /connect with freighter/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("wallet-state-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/connection cancelled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows connected state with address and disconnect action", async () => {
    mockRestore.mockResolvedValue(MOCK_SESSION);
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("wallet-state-connected")).toBeInTheDocument();
    });
    expect(screen.getByText(MOCK_SESSION.address)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
  });
});
