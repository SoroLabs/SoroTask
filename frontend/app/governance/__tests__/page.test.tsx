import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import GovernancePage from "../page";
import { QuadraticVoteCalculator } from "../components/QuadraticVoteCalculator";
import { useWalletOptional } from "@/app/context/WalletContext";
import { useSubgraphSubscription } from "@/src/lib/graphql";
import { signGovernanceVoteWithFreighter } from "../freighterVote";

expect.extend(toHaveNoViolations);

jest.mock("@/app/context/WalletContext", () => ({
  useWalletOptional: jest.fn(),
}));

jest.mock("@/src/lib/graphql", () => ({
  useSubgraphSubscription: jest.fn(),
}));

jest.mock("../freighterVote", () => ({
  signGovernanceVoteWithFreighter: jest.fn(),
}));

const MOCK_WALLET_ADDRESS = "GB7K2M4X9Q3T6P8W5R2N1V4C7Z8L3D6F9H2J5K8M";

function buildWalletMock(connected: boolean, balanceXlm = 2500) {
  return {
    status: connected ? "connected" : "disconnected",
    session: connected
      ? {
          address: MOCK_WALLET_ADDRESS,
          network: {
            network: "Futurenet",
            networkUrl: "https://horizon-futurenet.stellar.org",
            networkPassphrase: "Test SDF Future Network ; October 2022",
          },
        }
      : null,
    errorCode: null,
    errorMessage: null,
    isLoading: false,
    isConnectModalOpen: false,
    connectedAccounts: connected
      ? [
          {
            address: MOCK_WALLET_ADDRESS,
            walletType: "freighter",
            balanceXlm,
            gasEscrowXlm: 100,
            pendingYieldXlm: 10,
            activeTaskCount: 2,
          },
        ]
      : [],
    activeAccount: connected ? MOCK_WALLET_ADDRESS : null,
    aggregatePortfolio: {
      totalBalanceXlm: connected ? balanceXlm : 0,
      totalGasEscrowXlm: 0,
      totalPendingYieldXlm: 0,
      totalActiveTasks: 0,
      accountCount: connected ? 1 : 0,
    },
    openConnectModal: jest.fn(),
    closeConnectModal: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    connectWith: jest.fn().mockResolvedValue(undefined),
    switchAccount: jest.fn(),
    addConnectedAccount: jest.fn(),
    removeConnectedAccount: jest.fn(),
    disconnect: jest.fn(),
    clearError: jest.fn(),
    pendingTransactions: [],
    trackTransaction: jest.fn().mockReturnValue("tx-1"),
    speedUpTransaction: jest.fn(),
    dismissTransaction: jest.fn(),
  };
}

describe("Governance Portal Integration & Accessibility Suite", () => {
  const originalFetch = global.fetch;
  let capturedSubCallback: ((data: unknown) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedSubCallback = null;

    (useWalletOptional as jest.Mock).mockReturnValue(buildWalletMock(true));

    (useSubgraphSubscription as jest.Mock).mockImplementation(
      ({ onData }: { onData: (data: unknown) => void }) => {
        capturedSubCallback = onData;
        return { status: "connected" };
      },
    );

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { events: [] },
      }),
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  async function renderPortal() {
    const view = render(<GovernancePage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    return view;
  }

  it("renders governance proposals, quorum progress bars, calculator, and immutable audit log", async () => {
    await renderPortal();

    expect(
      screen.getByRole("heading", { name: /SoroTask DAO Governance Portal/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/SIP-042: Raise Keeper Execution/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/SIP-043: Calibrate Circuit Breaker/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Indexer GraphQL Live/i)).toBeInTheDocument();

    const progressBars = screen.getAllByRole("progressbar");
    expect(progressBars.length).toBeGreaterThanOrEqual(3);

    expect(
      screen.getByRole("heading", { name: /Immutable Governance Audit Log/i }),
    ).toBeInTheDocument();
  });

  it("updates quadratic stake cost via slider, numeric input, and presets", async () => {
    await renderPortal();

    expect(screen.getByTestId("quadratic-stake-cost")).toHaveTextContent(
      "100 XLM",
    );
    expect(screen.getByTestId("quadratic-marginal-cost")).toHaveTextContent(
      "+21 XLM",
    );

    // Move range slider
    const slider = screen.getByLabelText(/Quadratic votes slider/i);
    fireEvent.change(slider, { target: { value: "15" } });
    expect(screen.getByTestId("quadratic-stake-cost")).toHaveTextContent(
      "225 XLM",
    );

    // Numeric input
    const votesInput = screen.getByLabelText(/Desired Votes/i);
    fireEvent.change(votesInput, { target: { value: "20" } });
    expect(screen.getByTestId("quadratic-stake-cost")).toHaveTextContent(
      "400 XLM",
    );
    expect(screen.getByTestId("quadratic-remaining-stake")).toHaveTextContent(
      "2,100 XLM",
    );
    expect(screen.getByTestId("quadratic-marginal-cost")).toHaveTextContent(
      "+41 XLM",
    );

    // Empty numeric input safely resets to 0
    fireEvent.change(votesInput, { target: { value: "" } });
    expect(screen.getByTestId("quadratic-stake-cost")).toHaveTextContent(
      "0 XLM",
    );

    // Clicking Max preset sets votes to floor(sqrt(2500)) = 50
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByTestId("quadratic-stake-cost")).toHaveTextContent(
      "2,500 XLM",
    );

    // Exceeding stake displays validation warning and disables submit
    fireEvent.change(votesInput, { target: { value: "60" } });
    expect(screen.getByText(/Insufficient stake/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sign & Cast 60 For Votes/i }),
    ).toBeDisabled();
  });

  it("executes 1-click Freighter vote signing, updates live tally, and appends verified audit entry", async () => {
    const walletMock = buildWalletMock(true);
    (useWalletOptional as jest.Mock).mockReturnValue(walletMock);

    (signGovernanceVoteWithFreighter as jest.Mock).mockResolvedValueOnce({
      proposalId: 42,
      choice: "Against",
      votes: 12,
      stakeCommitted: 144,
      voter: MOCK_WALLET_ADDRESS,
      txHash: "0xdeadbeef12345678",
      signedXdr: "AAAA_SIGNED",
      submittedAt: 1774890000000,
      network: "Futurenet",
    });

    await renderPortal();

    fireEvent.click(screen.getByRole("radio", { name: /Vote Against/i }));
    fireEvent.change(screen.getByLabelText(/Desired Votes/i), {
      target: { value: "12" },
    });

    const submitBtn = screen.getByRole("button", {
      name: /Sign & Cast 12 Against Votes/i,
    });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Vote Signed & Broadcast via Freighter/i),
      ).toBeInTheDocument();
    });

    expect(signGovernanceVoteWithFreighter).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: 42,
        choice: "Against",
        votes: 12,
        availableStake: 2500,
        voterAddress: MOCK_WALLET_ADDRESS,
      }),
    );
    expect(walletMock.trackTransaction).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        /governance\.vote_signed \[SIP-042: \+12 Against \| 144 XLM\]/i,
      ),
    ).toBeInTheDocument();
  });

  it("applies real-time GraphQL subscription events and supports manual Sync + offline fallback", async () => {
    await renderPortal();

    const liveEvent = {
      eventAdded: {
        id: "ws-live-77",
        ledger_sequence: 1490500,
        contract_id: "CGOV",
        event_name: "VoteCast",
        data_json: JSON.stringify({
          proposal_id: 42,
          voter: "GD8888888888888888888888888888888888888888",
          choice: "For",
          weight: 25,
          stake_cost: 625,
        }),
        processed_at: "2026-11-24T13:00:00.000Z",
      },
    };

    expect(capturedSubCallback).not.toBeNull();

    await act(async () => {
      capturedSubCallback?.(liveEvent);
      capturedSubCallback?.(liveEvent); // deduplicated
    });

    expect(
      screen.getByText(
        /governance\.vote_cast \[SIP-042: \+25 For \| 625 XLM\]/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/For: 785/i)).toBeInTheDocument();

    // Trigger manual Sync failure to verify graceful fallback handling
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: /Refresh governance tallies from indexer/i,
        }),
      );
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("displays fallback and reconnecting indexer badges cleanly", async () => {
    (useSubgraphSubscription as jest.Mock).mockReturnValue({
      status: "reconnecting",
    });
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("Down"));

    const { unmount } = render(<GovernancePage />);
    expect(screen.getByText(/Syncing Indexer/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    unmount();

    (useSubgraphSubscription as jest.Mock).mockReturnValue({
      status: "error",
    });
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("Down"));

    render(<GovernancePage />);
    await waitFor(() => {
      expect(
        screen.getByText(/Cached Snapshot \(GraphQL Standby\)/i),
      ).toBeInTheDocument();
    });
  });

  it("handles disconnected wallet prompt, header connect, and proposal filtering", async () => {
    const disconnectedWallet = buildWalletMock(false);
    (useWalletOptional as jest.Mock).mockReturnValue(disconnectedWallet);

    await renderPortal();

    fireEvent.click(
      screen.getByRole("button", { name: /Connect Freighter to Sign Vote/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Connect Freighter$/i }),
    );
    expect(disconnectedWallet.connect).toHaveBeenCalledTimes(2);

    // Filter proposals to Passed only -> SIP-044
    fireEvent.click(screen.getByRole("button", { name: "Passed" }));
    expect(
      screen.getByText(/SIP-044: Expand Keeper Slashing/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/SIP-042: Raise Keeper Execution/i),
    ).not.toBeInTheDocument();

    // Select Passed proposal -> shows closed status
    fireEvent.click(screen.getByRole("button", { name: /Inspect & Vote/i }));
    expect(
      screen.getByText(/Voting is closed for this proposal \(Passed\)/i),
    ).toBeInTheDocument();

    // Filter search by parameter name -> empty when combined with Passed filter
    fireEvent.change(screen.getByLabelText(/Search governance proposals/i), {
      target: { value: "nonexistent-param-xyz" },
    });
    expect(
      screen.getByText(/No governance proposals match the current filter/i),
    ).toBeInTheDocument();
  });

  it("displays signing error banner when Freighter rejects a vote", async () => {
    (signGovernanceVoteWithFreighter as jest.Mock).mockRejectedValueOnce(
      new Error("Vote signature request was rejected in Freighter."),
    );

    await renderPortal();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Sign & Cast 10 For Votes/i }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Vote signature request was rejected in Freighter/i),
      ).toBeInTheDocument();
    });
  });

  it("renders empty fallback cleanly when calculator has no selected proposal", () => {
    render(
      <QuadraticVoteCalculator
        proposal={null}
        availableStake={1000}
        isWalletConnected={false}
        isWalletConnecting={false}
        isPreviewStake={true}
        isSigningVote={false}
        voteError={null}
        onConnectWallet={jest.fn()}
        onCastVote={jest.fn()}
      />,
    );
    expect(
      screen.getByText(
        /Select a proposal to calculate quadratic voting power/i,
      ),
    ).toBeInTheDocument();
  });

  it("passes jest-axe accessibility audit with zero violations", async () => {
    const { container } = await renderPortal();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
