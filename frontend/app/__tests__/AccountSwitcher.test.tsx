import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AccountSwitcher } from "@/src/components/AccountSwitcher";
import { WalletProvider } from "@/app/context/WalletContext";

// Mock wallet lib
jest.mock("@/app/lib/wallet", () => ({
  connectWallet: jest.fn().mockResolvedValue({
    address: "GBDEV111111111111111111111111111111111111111111111111111111",
    network: {
      network: "TESTNET",
      networkUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
  }),
  restoreSession: jest.fn().mockResolvedValue({
    address: "GBDEV111111111111111111111111111111111111111111111111111111",
    network: {
      network: "TESTNET",
      networkUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
  }),
  restoreWalletSession: jest.fn().mockResolvedValue({
    address: "GBDEV111111111111111111111111111111111111111111111111111111",
    network: {
      network: "TESTNET",
      networkUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
  }),
  watchWalletChanges: jest.fn().mockReturnValue(() => {}),
  disconnectWallet: jest.fn(),
  WalletConnectionError: class extends Error {},
}));

describe("AccountSwitcher Component", () => {
  beforeEach(() => {
    localStorage.clear();
    const mockAccounts = [
      {
        address: "GBDEV111111111111111111111111111111111111111111111111111111",
        label: "Primary Vault",
        walletType: "freighter",
        balanceXlm: 2450.5,
        gasEscrowXlm: 120.0,
        pendingYieldXlm: 14.85,
        activeTaskCount: 3,
      },
      {
        address: "GBDEV222222222222222222222222222222222222222222222222222222",
        label: "Secondary Operations",
        walletType: "manual",
        balanceXlm: 1500.0,
        gasEscrowXlm: 80.0,
        pendingYieldXlm: 5.15,
        activeTaskCount: 2,
      },
    ];
    localStorage.setItem("sorotask_connected_accounts", JSON.stringify(mockAccounts));
  });

  it("renders connect wallet button when disconnected", () => {
    localStorage.setItem("sorotask_wallet_disconnected", "true");
    render(
      <WalletProvider>
        <AccountSwitcher />
      </WalletProvider>
    );

    expect(screen.getByText(/Connect Wallet/i)).toBeInTheDocument();
  });
});
