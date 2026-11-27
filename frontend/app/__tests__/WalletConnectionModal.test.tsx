/**
 * WalletConnectionModal.test.tsx
 *
 * Covers the unified five-wallet hub, provider switching, error feedback and
 * accessible dialog behaviour (role, Escape dismissal, focusable controls).
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider } from "@/app/context/WalletContext";
import { WalletConnectionModal } from "@/app/components/WalletConnectionModal";

jest.mock("@/app/lib/wallet", () => {
  const meta = [
    {
      id: "freighter",
      name: "Freighter",
      description: "Browser extension",
      kind: "browser",
    },
    {
      id: "xbull",
      name: "xBull",
      description: "Browser extension",
      kind: "browser",
    },
    { id: "albedo", name: "Albedo", description: "Web wallet", kind: "web" },
    { id: "lobstr", name: "LOBSTR", description: "Web wallet", kind: "web" },
    {
      id: "ledger",
      name: "Ledger",
      description: "Hardware wallet",
      kind: "hardware",
    },
  ];
  return {
    WALLET_PROVIDERS_META: meta,
    checkWalletAvailability: jest.fn(async () => true),
    connectWallet: jest.fn(),
    connectWalletWith: jest.fn(),
    restoreSession: jest.fn(),
    restoreWalletSession: jest.fn(),
    disconnectWallet: jest.fn(),
    signTransactionWith: jest.fn(),
    saveWalletSession: jest.fn(),
    watchWalletChanges: jest.fn(() => jest.fn()),
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
  };
});

jest.mock("@/app/lib/hardwareWallet", () => ({
  buildStellarPath: jest.fn((account = 0) => `m/44'/148'/${account}'`),
  bytesToBase64: jest.fn(() => "cHVibGljLWtleQ=="),
  encodeSignatureForRpc: jest.fn(() => "c2lnbmF0dXJl"),
  HardwareWalletConnectionError: class HardwareWalletConnectionError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "HardwareWalletConnectionError";
    }
  },
  openLedgerDevice: jest.fn(),
  reconnectLedgerDevice: jest.fn().mockResolvedValue(null),
}));

import {
  connectWalletWith,
  restoreWalletSession,
  WalletConnectionError,
} from "@/app/lib/wallet";

const mockConnectWith = connectWalletWith as jest.Mock;
const mockRestoreWallet = restoreWalletSession as jest.Mock;

const MOCK_SESSION = {
  address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRS",
  network: {
    network: "FUTURENET",
    networkUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
  },
};

function ModalHost({
  open = true,
  onClose = jest.fn(),
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  return <WalletConnectionModal open={open} onClose={onClose} />;
}

function renderModal(props?: { open?: boolean; onClose?: () => void }) {
  return render(
    <WalletProvider>
      <ModalHost {...props} />
    </WalletProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRestoreWallet.mockResolvedValue(null);
});

describe("WalletConnectionModal", () => {
  it("lists all five supported wallets with accessible buttons", async () => {
    renderModal();

    await waitFor(() => {
      expect(
        screen.getByTestId("wallet-state-disconnected"),
      ).toBeInTheDocument();
    });

    for (const name of ["Freighter", "xBull", "Albedo", "LOBSTR", "Ledger"]) {
      expect(
        screen.getByRole("button", { name: `Connect with ${name}` }),
      ).toBeInTheDocument();
    }
  });

  it("exposes an accessible dialog and dismisses on Escape", async () => {
    const onClose = jest.fn();
    renderModal({ onClose });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("connects with the selected non-Freighter provider", async () => {
    mockConnectWith.mockResolvedValue({ ...MOCK_SESSION, providerId: "xbull" });

    renderModal();
    await waitFor(() => {
      expect(
        screen.getByTestId("wallet-state-disconnected"),
      ).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Connect with xBull" }),
    );

    expect(mockConnectWith).toHaveBeenCalledWith("xbull");
    await waitFor(() => {
      expect(screen.getByTestId("wallet-state-connected")).toBeInTheDocument();
    });
    expect(screen.getByText(MOCK_SESSION.address)).toBeInTheDocument();
  });

  it("shows an error with a retry action when connection fails", async () => {
    mockConnectWith.mockRejectedValue(
      new WalletConnectionError("USER_REJECTED", "User rejected the request."),
    );

    renderModal();
    await waitFor(() => {
      expect(
        screen.getByTestId("wallet-state-disconnected"),
      ).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Connect with Albedo" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("wallet-state-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/connection cancelled/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("shows the restored session with a disconnect action", async () => {
    mockRestoreWallet.mockResolvedValue({
      ...MOCK_SESSION,
      providerId: "lobstr",
    });

    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("wallet-state-connected")).toBeInTheDocument();
    });
    expect(screen.getByText(MOCK_SESSION.address)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /disconnect/i }),
    ).toBeInTheDocument();
  });
});
