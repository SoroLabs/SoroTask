import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  UpgradeModal,
  DEFAULT_PROPOSAL,
  UpgradeProposal,
} from "../UpgradeModal";

// Mock WalletContext
jest.mock("@/app/context/WalletContext", () => ({
  useWalletOptional: () => ({
    session: {
      address: "GDEMO1234567890",
      network: { networkPassphrase: "Test SDF Network" },
    },
    status: "connected",
  }),
}));

describe("UpgradeModal Governance Component", () => {
  const mockOnClose = jest.fn();
  const mockOnVoteCast = jest.fn();
  const mockOnDelegate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders proposal title, on-chain WASM hashes, and live timelock countdown", () => {
    render(
      <UpgradeModal
        isOpen={true}
        proposal={DEFAULT_PROPOSAL}
        onClose={mockOnClose}
        onVoteCast={mockOnVoteCast}
        onDelegate={mockOnDelegate}
      />,
    );

    expect(screen.getByText(DEFAULT_PROPOSAL.title)).toBeInTheDocument();
    expect(
      screen.getByText(DEFAULT_PROPOSAL.currentWasmHash),
    ).toBeInTheDocument();
    expect(
      screen.getByText(DEFAULT_PROPOSAL.proposedWasmHash),
    ).toBeInTheDocument();
    expect(screen.getByTestId("timelock-countdown")).toBeInTheDocument();
  });

  it("allows voting For, Against, and Abstain via connected wallet", async () => {
    render(
      <UpgradeModal
        isOpen={true}
        proposal={DEFAULT_PROPOSAL}
        onClose={mockOnClose}
        onVoteCast={mockOnVoteCast}
      />,
    );

    const voteForBtn = screen.getByRole("button", { name: /Vote For/i });
    fireEvent.click(voteForBtn);

    await waitFor(() => {
      expect(mockOnVoteCast).toHaveBeenCalledWith(DEFAULT_PROPOSAL.id, "for");
      expect(
        screen.getByText(/Your vote \(FOR\) was recorded/i),
      ).toBeInTheDocument();
    });
  });

  it("allows vote delegation to a delegate address", () => {
    render(
      <UpgradeModal
        isOpen={true}
        proposal={DEFAULT_PROPOSAL}
        onClose={mockOnClose}
        onDelegate={mockOnDelegate}
      />,
    );

    const delegateBtn = screen.getByRole("button", { name: /Delegate Vote/i });
    fireEvent.click(delegateBtn);

    const input = screen.getByPlaceholderText(/e\.g\. GDELEGATE/i);
    fireEvent.change(input, { target: { value: "GDELEGATE9999999999" } });

    const confirmBtn = screen.getByRole("button", {
      name: /Confirm Delegation/i,
    });
    fireEvent.click(confirmBtn);

    expect(mockOnDelegate).toHaveBeenCalledWith(
      DEFAULT_PROPOSAL.id,
      "GDELEGATE9999999999",
    );
    expect(
      screen.getByText(/Voting power successfully delegated/i),
    ).toBeInTheDocument();
  });

  it("switches to Side-by-Side Diffs tab and toggles between Source and Bytecode", () => {
    render(
      <UpgradeModal
        isOpen={true}
        proposal={DEFAULT_PROPOSAL}
        onClose={mockOnClose}
      />,
    );

    const diffsTab = screen.getByRole("button", {
      name: /Side-by-Side Diffs/i,
    });
    fireEvent.click(diffsTab);

    expect(screen.getByText(/acquire_reentrancy_lock/i)).toBeInTheDocument();

    const bytecodeBtn = screen.getByRole("button", {
      name: /WASM Disassembly/i,
    });
    fireEvent.click(bytecodeBtn);

    expect(screen.getByText(/\$acquire_lock/i)).toBeInTheDocument();
  });

  it("switches to Audit Reports tab and displays independent security findings", () => {
    render(
      <UpgradeModal
        isOpen={true}
        proposal={DEFAULT_PROPOSAL}
        onClose={mockOnClose}
      />,
    );

    const auditsTab = screen.getByRole("button", { name: /Audit Reports/i });
    fireEvent.click(auditsTab);

    expect(screen.getByText("Trail of Bits")).toBeInTheDocument();
    expect(screen.getByText("OpenZeppelin")).toBeInTheDocument();
    expect(
      screen.getByText(/All reported medium and low severity findings/i),
    ).toBeInTheDocument();
  });

  it("verifies reproducible WASM hash accurately matching and mismatching", () => {
    render(
      <UpgradeModal
        isOpen={true}
        proposal={DEFAULT_PROPOSAL}
        onClose={mockOnClose}
      />,
    );

    const verifyTab = screen.getByRole("button", {
      name: /Reproducible WASM Hash/i,
    });
    fireEvent.click(verifyTab);

    const input = screen.getByPlaceholderText(
      /Paste compiled WASM SHA-256 hash/i,
    );
    const verifyBtn = screen.getByRole("button", { name: /Verify Hash/i });

    // Test Mismatch
    fireEvent.change(input, {
      target: {
        value:
          "0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    fireEvent.click(verifyBtn);
    expect(
      screen.getByTestId("verification-mismatch-badge"),
    ).toBeInTheDocument();

    // Test Exact Match
    fireEvent.change(input, {
      target: { value: DEFAULT_PROPOSAL.proposedWasmHash },
    });
    fireEvent.click(verifyBtn);
    expect(screen.getByTestId("verification-match-badge")).toBeInTheDocument();
  });

  it("triggers onClose when close button clicked", () => {
    render(
      <UpgradeModal
        isOpen={true}
        proposal={DEFAULT_PROPOSAL}
        onClose={mockOnClose}
      />,
    );

    const closeBtn = screen.getByRole("button", {
      name: /Close upgrade modal/i,
    });
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
