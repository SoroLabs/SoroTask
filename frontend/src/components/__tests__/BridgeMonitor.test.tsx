import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BridgeMonitor, BridgeTransferTask } from "../BridgeMonitor";

describe("BridgeMonitor Component", () => {
  const mockTasks: BridgeTransferTask[] = [
    {
      id: "br-tx-test-1",
      sourceChain: "stellar",
      destinationChain: "ethereum",
      tokenSymbol: "USDC",
      amount: "5,000.00",
      sender: "GA11...9999",
      recipient: "0x12...3456",
      currentStep: "state_proof",
      stepStates: {
        source_lock: "verified",
        relayer_gossip: "verified",
        state_proof: "delayed",
        destination_execution: "pending",
      },
      sourceTxHash: "abc123sourcehash",
      proofDetails: {
        proofType: "merkle_patricia",
        proofHash: "0xproof123",
        blockConfirmations: 8,
        requiredConfirmations: 12,
        merkleRoot: "0xroot456",
        foreignBlockNumber: 1234567,
      },
      initiatedAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedAt: "2026-01-01T00:05:00.000Z",
      elapsedSeconds: 300,
      slaThresholdSeconds: 120,
      delayReason:
        "Network congestion on Ethereum Sepolia. 8/12 blocks confirmed.",
    },
    {
      id: "br-tx-test-2",
      sourceChain: "stellar",
      destinationChain: "arbitrum",
      tokenSymbol: "XLM",
      amount: "1,000.00",
      sender: "GB22...8888",
      recipient: "0x98...7654",
      currentStep: "destination_execution",
      stepStates: {
        source_lock: "verified",
        relayer_gossip: "verified",
        state_proof: "verified",
        destination_execution: "verified",
      },
      sourceTxHash: "stellarhash2",
      destinationTxHash: "arbitrumhash2",
      proofDetails: {
        proofType: "zk_snark",
        proofHash: "0xzkproof789",
        blockConfirmations: 15,
        requiredConfirmations: 15,
        merkleRoot: "0xzkroot",
        verifiedAt: "2026-01-01T00:02:00.000Z",
      },
      initiatedAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedAt: "2026-01-01T00:02:00.000Z",
      elapsedSeconds: 120,
      slaThresholdSeconds: 180,
    },
  ];

  it("renders bridge monitor header and task list", () => {
    render(<BridgeMonitor initialTasks={mockTasks} />);

    expect(screen.getByText("Cross-Chain Bridge Monitor")).toBeInTheDocument();
    expect(screen.getAllByText("br-tx-test-1")[0]).toBeInTheDocument();
    expect(screen.getAllByText("br-tx-test-2")[0]).toBeInTheDocument();
  });

  it("renders the 4 visual lifecycle steps for the selected task", () => {
    render(<BridgeMonitor initialTasks={mockTasks} />);

    expect(
      screen.getByTestId("lifecycle-step-source_lock"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("lifecycle-step-relayer_gossip"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("lifecycle-step-state_proof"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("lifecycle-step-destination_execution"),
    ).toBeInTheDocument();

    expect(screen.getByTestId("lifecycle-step-source_lock")).toHaveTextContent(
      "Source Lock",
    );
    expect(
      screen.getByTestId("lifecycle-step-relayer_gossip"),
    ).toHaveTextContent("Relayer Gossip");
    expect(screen.getByTestId("lifecycle-step-state_proof")).toHaveTextContent(
      "State Proof Verification",
    );
    expect(
      screen.getByTestId("lifecycle-step-destination_execution"),
    ).toHaveTextContent("Destination Execution");
  });

  it("displays cryptographic proof verification badges", () => {
    render(<BridgeMonitor initialTasks={mockTasks} />);

    expect(screen.getByTestId("badge-confirmations")).toBeInTheDocument();
    expect(screen.getByText("8/12")).toBeInTheDocument();

    expect(screen.getByTestId("badge-state-proof")).toBeInTheDocument();
    expect(screen.getByText(/MERKLE_PATRICIA/i)).toBeInTheDocument();

    expect(screen.getByTestId("badge-settlement")).toBeInTheDocument();
  });

  it("displays direct block explorer links", () => {
    render(<BridgeMonitor initialTasks={mockTasks} />);

    const stellarLink = screen.getByRole("link", {
      name: /Stellar Source Tx/i,
    });
    expect(stellarLink).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/abc123sourcehash",
    );
  });

  it("shows delay alert banner when transfer is delayed", () => {
    render(<BridgeMonitor initialTasks={mockTasks} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Transfer Delay Warning")).toBeInTheDocument();
    expect(
      screen.getByText(/Network congestion on Ethereum Sepolia/i),
    ).toBeInTheDocument();
  });

  it("allows pausing and resuming WebSocket live stream", () => {
    render(<BridgeMonitor initialTasks={mockTasks} />);

    const pauseBtn = screen.getByRole("button", { name: /Pause live stream/i });
    expect(screen.getByText("WebSocket Live")).toBeInTheDocument();

    fireEvent.click(pauseBtn);
    expect(screen.getByText("Paused")).toBeInTheDocument();

    const resumeBtn = screen.getByRole("button", { name: /Resume live/i });
    fireEvent.click(resumeBtn);
    expect(screen.getByText("WebSocket Live")).toBeInTheDocument();
  });

  it("filters tasks by search input and status", () => {
    render(<BridgeMonitor initialTasks={mockTasks} />);

    const searchInput = screen.getByPlaceholderText(/Search tasks by ID/i);
    fireEvent.change(searchInput, { target: { value: "XLM" } });

    expect(screen.queryByText("br-tx-test-1")).not.toBeInTheDocument();
    expect(screen.getAllByText("br-tx-test-2")[0]).toBeInTheDocument();
  });

  it("allows manual simulation of next step", () => {
    render(<BridgeMonitor initialTasks={mockTasks} />);

    const simBtn = screen.getByRole("button", { name: /Simulate Next Step/i });
    fireEvent.click(simBtn);

    // Destination execution should now be active
    expect(
      screen.getByTestId("lifecycle-step-destination_execution"),
    ).toBeInTheDocument();
  });
});
