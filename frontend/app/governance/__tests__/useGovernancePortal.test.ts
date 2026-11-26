import { act, renderHook } from "@testing-library/react";
import { useGovernancePortal } from "../useGovernancePortal";
import { useWalletOptional } from "@/app/context/WalletContext";
import { useSubgraphSubscription } from "@/src/lib/graphql";
import { signGovernanceVoteWithFreighter } from "../freighterVote";

jest.mock("@/app/context/WalletContext", () => ({
  useWalletOptional: jest.fn(),
}));

jest.mock("@/src/lib/graphql", () => ({
  useSubgraphSubscription: jest.fn(),
}));

jest.mock("../freighterVote", () => ({
  signGovernanceVoteWithFreighter: jest.fn(),
}));

function makeWallet(address: string | null, connectedAccounts: unknown[] = []) {
  return {
    status: address ? "connected" : "disconnected",
    session: address
      ? {
          address,
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
    connectedAccounts,
    activeAccount: address,
    aggregatePortfolio: {
      totalBalanceXlm: 0,
      totalGasEscrowXlm: 0,
      totalPendingYieldXlm: 0,
      totalActiveTasks: 0,
      accountCount: connectedAccounts.length,
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
    trackTransaction: jest.fn().mockReturnValue("tx-99"),
    speedUpTransaction: jest.fn(),
    dismissTransaction: jest.fn(),
  };
}

describe("useGovernancePortal Hook Edge Cases", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    (useSubgraphSubscription as jest.Mock).mockReturnValue({
      status: "connecting",
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("handles disconnected castVote, unknown audit IDs, and clearVoteError", async () => {
    (useWalletOptional as jest.Mock).mockReturnValue(makeWallet(null));

    const { result } = renderHook(() =>
      useGovernancePortal({ enableLiveSubscription: false }),
    );

    expect(result.current.indexerState).toBe("connecting");
    expect(result.current.verifyAuditEntry("unknown-entry-id")).toBe(false);

    let receipt: unknown;
    await act(async () => {
      receipt = await result.current.castVote(42, "For", 5);
    });
    expect(receipt).toBeNull();
    expect(result.current.voteError).toMatch(/Connect your Freighter wallet/i);

    act(() => {
      result.current.clearVoteError();
    });
    expect(result.current.voteError).toBeNull();
  });

  it("falls back to default connected stake, handles non-Error throws, and refreshes via HTTP GraphQL", async () => {
    (useWalletOptional as jest.Mock).mockReturnValue(
      makeWallet("GSHORTWALLET", []),
    );
    (useSubgraphSubscription as jest.Mock).mockReturnValue({ status: "idle" });

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          events: [
            {
              id: "sync-event-1",
              ledger_sequence: 1491000,
              contract_id: "CGOV",
              event_name: "VoteCast",
              data_json: JSON.stringify({
                proposal_id: 42,
                voter: "GSHORT",
                choice: "For",
                weight: 10,
              }),
              processed_at: "2026-11-24T15:00:00.000Z",
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useGovernancePortal({ enableLiveSubscription: false }),
    );

    expect(result.current.availableStake).toBe(2500);

    await act(async () => {
      await result.current.refreshFromIndexer();
    });
    expect(result.current.indexerState).toBe("live");
    expect(result.current.liveEventCount).toBe(1);

    (signGovernanceVoteWithFreighter as jest.Mock).mockRejectedValueOnce(
      "non-error rejection",
    );
    await act(async () => {
      await result.current.castVote(42, "For", 5);
    });
    expect(result.current.voteError).toMatch(/Failed to sign governance vote/i);
  });
});
