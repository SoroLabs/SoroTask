/**
 * wallet.test.ts
 *
 * Unit tests for the Freighter API wrapper in app/lib/wallet.ts.
 * All @stellar/freighter-api calls are mocked — no real extension needed.
 */

import {
  connectWallet,
  restoreSession,
  isFreighterInstalled,
  truncateAddress,
  WalletConnectionError,
  EXPECTED_NETWORK_PASSPHRASE,
} from "@/app/lib/wallet";

// ---------------------------------------------------------------------------
// Mock @stellar/freighter-api
// ---------------------------------------------------------------------------

jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  isAllowed: jest.fn(),
  requestAccess: jest.fn(),
  getAddress: jest.fn(),
  getNetworkDetails: jest.fn(),
  WatchWalletChanges: jest.fn().mockImplementation(() => ({
    watch: jest.fn(),
    stop: jest.fn(),
  })),
}));

import {
  isConnected,
  isAllowed,
  requestAccess,
  getAddress,
  getNetworkDetails,
} from "@stellar/freighter-api";

const mockIsConnected = isConnected as jest.Mock;
const mockIsAllowed = isAllowed as jest.Mock;
const mockRequestAccess = requestAccess as jest.Mock;
const mockGetAddress = getAddress as jest.Mock;
const mockGetNetworkDetails = getNetworkDetails as jest.Mock;

const FUTURENET_DETAILS = {
  network: "FUTURENET",
  networkUrl: "https://rpc-futurenet.stellar.org",
  networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
  sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
  error: undefined,
};

const TESTNET_DETAILS = {
  network: "TESTNET",
  networkUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  error: undefined,
};

const MOCK_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRS";

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isFreighterInstalled
// ---------------------------------------------------------------------------

describe("isFreighterInstalled", () => {
  it("returns true when Freighter is installed", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    expect(await isFreighterInstalled()).toBe(true);
  });

  it("returns false when Freighter is not installed", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: false });
    expect(await isFreighterInstalled()).toBe(false);
  });

  it("returns false when the API throws", async () => {
    mockIsConnected.mockRejectedValue(new Error("Extension not found"));
    expect(await isFreighterInstalled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// connectWallet
// ---------------------------------------------------------------------------

describe("connectWallet", () => {
  it("returns a session when connection succeeds on Futurenet", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({ address: MOCK_ADDRESS, error: undefined });
    mockGetNetworkDetails.mockResolvedValue(FUTURENET_DETAILS);

    const session = await connectWallet();

    expect(session.address).toBe(MOCK_ADDRESS);
    expect(session.network.network).toBe("FUTURENET");
    expect(session.network.networkPassphrase).toBe(EXPECTED_NETWORK_PASSPHRASE);
  });

  it("throws NOT_INSTALLED when Freighter is not present", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: false });

    await expect(connectWallet()).rejects.toMatchObject({
      code: "NOT_INSTALLED",
    });
  });

  it("throws USER_REJECTED when user dismisses the popup", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({
      address: "",
      error: { message: "User declined access" },
    });

    await expect(connectWallet()).rejects.toMatchObject({
      code: "USER_REJECTED",
    });
  });

  it("throws USER_REJECTED when address is empty string", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({ address: "", error: undefined });

    await expect(connectWallet()).rejects.toMatchObject({
      code: "USER_REJECTED",
    });
  });

  it("throws WRONG_NETWORK when wallet is on Testnet instead of Futurenet", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({ address: MOCK_ADDRESS, error: undefined });
    mockGetNetworkDetails.mockResolvedValue(TESTNET_DETAILS);

    await expect(connectWallet()).rejects.toMatchObject({
      code: "WRONG_NETWORK",
    });
  });

  it("throws UNKNOWN when getNetworkDetails returns an error", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({ address: MOCK_ADDRESS, error: undefined });
    mockGetNetworkDetails.mockResolvedValue({
      error: { message: "RPC unavailable" },
    });

    await expect(connectWallet()).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });

  it("WalletConnectionError has the correct name", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: false });

    try {
      await connectWallet();
    } catch (err) {
      expect(err).toBeInstanceOf(WalletConnectionError);
      expect((err as WalletConnectionError).name).toBe("WalletConnectionError");
    }
  });
});

// ---------------------------------------------------------------------------
// restoreSession
// ---------------------------------------------------------------------------

describe("restoreSession", () => {
  it("returns a session when the app is already allowed", async () => {
    mockIsAllowed.mockResolvedValue({ isAllowed: true });
    mockGetAddress.mockResolvedValue({ address: MOCK_ADDRESS, error: undefined });
    mockGetNetworkDetails.mockResolvedValue(FUTURENET_DETAILS);

    const session = await restoreSession();

    expect(session).not.toBeNull();
    expect(session?.address).toBe(MOCK_ADDRESS);
  });

  it("returns null when the app is not allowed", async () => {
    mockIsAllowed.mockResolvedValue({ isAllowed: false });

    expect(await restoreSession()).toBeNull();
  });

  it("returns null when getAddress returns empty string", async () => {
    mockIsAllowed.mockResolvedValue({ isAllowed: true });
    mockGetAddress.mockResolvedValue({ address: "", error: undefined });

    expect(await restoreSession()).toBeNull();
  });

  it("returns null when getNetworkDetails errors", async () => {
    mockIsAllowed.mockResolvedValue({ isAllowed: true });
    mockGetAddress.mockResolvedValue({ address: MOCK_ADDRESS, error: undefined });
    mockGetNetworkDetails.mockResolvedValue({ error: { message: "fail" } });

    expect(await restoreSession()).toBeNull();
  });

  it("returns null and does not throw when the API throws unexpectedly", async () => {
    mockIsAllowed.mockRejectedValue(new Error("Extension crashed"));

    expect(await restoreSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// truncateAddress
// ---------------------------------------------------------------------------

describe("truncateAddress", () => {
  it("truncates a long address with default chars=4", () => {
    const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRS";
    const result = truncateAddress(addr);
    expect(result).toMatch(/^GABCD\.\.\.PQRS$/);
  });

  it("returns the address unchanged when it is short enough", () => {
    const short = "GABCD";
    expect(truncateAddress(short)).toBe(short);
  });

  it("respects a custom chars value", () => {
    const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRS";
    const result = truncateAddress(addr, 6);
    expect(result).toMatch(/^GABCDEF\.\.\./);
  });
});
