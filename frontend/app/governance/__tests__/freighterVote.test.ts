import { signTransaction } from "@stellar/freighter-api";
import { isFreighterInstalled } from "@/app/lib/wallet";
import {
  buildCastVoteTransactionXdr,
  FreighterVoteError,
  signGovernanceVoteWithFreighter,
} from "../freighterVote";

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
  isConnected: jest.fn(),
  isAllowed: jest.fn(),
  requestAccess: jest.fn(),
  getAddress: jest.fn(),
  getNetworkDetails: jest.fn(),
  WatchWalletChanges: jest.fn(),
}));

jest.mock("@/app/lib/wallet", () => ({
  EXPECTED_NETWORK_PASSPHRASE: "Test SDF Future Network ; October 2022",
  isFreighterInstalled: jest.fn(),
}));

const MOCK_VOTER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("Freighter 1-Click Governance Vote Signing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isFreighterInstalled as jest.Mock).mockResolvedValue(true);
  });

  it("builds an unsigned XDR envelope (and falls back for mock addresses)", () => {
    const xdr = buildCastVoteTransactionXdr({
      voterAddress: "GMOCK_ADDRESS",
      proposalId: 42,
      choice: "For",
      votes: 10,
      stakeCommitted: 100,
      contractId: "CGOV_MOCK",
      networkPassphrase: "Test SDF Future Network ; October 2022",
    });

    expect(typeof xdr).toBe("string");
    expect(xdr.length).toBeGreaterThan(20);
  });

  it("signs a quadratic vote with Freighter (string XDR response)", async () => {
    (signTransaction as jest.Mock).mockResolvedValueOnce("AAAA_SIGNED_XDR_1");

    const receipt = await signGovernanceVoteWithFreighter({
      proposalId: 42,
      choice: "For",
      votes: 10,
      availableStake: 500,
      voterAddress: MOCK_VOTER,
    });

    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(receipt.proposalId).toBe(42);
    expect(receipt.choice).toBe("For");
    expect(receipt.votes).toBe(10);
    expect(receipt.stakeCommitted).toBe(100);
    expect(receipt.signedXdr).toBe("AAAA_SIGNED_XDR_1");
    expect(receipt.txHash).toMatch(/^0x[0-9a-f]+$/);
  });

  it("supports Freighter v6 object response with signedTxXdr", async () => {
    (signTransaction as jest.Mock).mockResolvedValueOnce({
      signedTxXdr: "AAAA_SIGNED_OBJ_XDR",
      signerAddress: MOCK_VOTER,
    });

    const receipt = await signGovernanceVoteWithFreighter({
      proposalId: 43,
      choice: "Against",
      votes: 5,
      availableStake: 100,
      voterAddress: MOCK_VOTER,
    });

    expect(receipt.signedXdr).toBe("AAAA_SIGNED_OBJ_XDR");
    expect(receipt.stakeCommitted).toBe(25);
  });

  it("throws typed FreighterVoteError for disconnected, invalid, insufficient stake, or missing extension", async () => {
    await expect(
      signGovernanceVoteWithFreighter({
        proposalId: 42,
        choice: "For",
        votes: 5,
        availableStake: 100,
        voterAddress: "",
      }),
    ).rejects.toMatchObject({ code: "WALLET_DISCONNECTED" });

    await expect(
      signGovernanceVoteWithFreighter({
        proposalId: 42,
        choice: "For",
        votes: 0,
        availableStake: 100,
        voterAddress: MOCK_VOTER,
      }),
    ).rejects.toMatchObject({ code: "INVALID_VOTE" });

    await expect(
      signGovernanceVoteWithFreighter({
        proposalId: 42,
        choice: "For",
        votes: 20,
        availableStake: 100,
        voterAddress: MOCK_VOTER,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STAKE" });

    (isFreighterInstalled as jest.Mock).mockResolvedValueOnce(false);
    await expect(
      signGovernanceVoteWithFreighter({
        proposalId: 42,
        choice: "For",
        votes: 5,
        availableStake: 100,
        voterAddress: MOCK_VOTER,
      }),
    ).rejects.toMatchObject({ code: "NOT_INSTALLED" });
  });

  it("maps Freighter rejection and signing failures cleanly", async () => {
    (signTransaction as jest.Mock).mockResolvedValueOnce({
      error: { message: "User rejected transaction" },
    });

    await expect(
      signGovernanceVoteWithFreighter({
        proposalId: 42,
        choice: "Abstain",
        votes: 3,
        availableStake: 100,
        voterAddress: MOCK_VOTER,
      }),
    ).rejects.toMatchObject({ code: "USER_REJECTED" });

    (signTransaction as jest.Mock).mockResolvedValueOnce({
      error: "Unexpected signing timeout",
    });

    await expect(
      signGovernanceVoteWithFreighter({
        proposalId: 42,
        choice: "For",
        votes: 3,
        availableStake: 100,
        voterAddress: MOCK_VOTER,
      }),
    ).rejects.toMatchObject({ code: "SIGNING_FAILED" });

    (signTransaction as jest.Mock).mockRejectedValueOnce(
      new Error("User denied prompt"),
    );

    await expect(
      signGovernanceVoteWithFreighter({
        proposalId: 42,
        choice: "For",
        votes: 3,
        availableStake: 100,
        voterAddress: MOCK_VOTER,
      }),
    ).rejects.toMatchObject({ code: "USER_REJECTED" });

    (signTransaction as jest.Mock).mockRejectedValueOnce(
      new Error("Transport offline"),
    );

    await expect(
      signGovernanceVoteWithFreighter({
        proposalId: 42,
        choice: "For",
        votes: 3,
        availableStake: 100,
        voterAddress: MOCK_VOTER,
      }),
    ).rejects.toMatchObject({ code: "SIGNING_FAILED" });

    (signTransaction as jest.Mock).mockResolvedValueOnce({
      signedTxXdr: "",
    });

    await expect(
      signGovernanceVoteWithFreighter({
        proposalId: 42,
        choice: "For",
        votes: 3,
        availableStake: 100,
        voterAddress: MOCK_VOTER,
      }),
    ).rejects.toBeInstanceOf(FreighterVoteError);
  });
});
