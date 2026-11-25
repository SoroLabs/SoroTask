import {
  DEFAULT_MOCK_ACCOUNT,
  ALTERNATIVE_MOCK_ACCOUNT,
  MockWalletProvider,
  mockWalletConnect,
} from "../tests/e2e/helpers";

describe("E2E Helpers & Mock Wallet Provider", () => {
  it("defines valid default and alternative mock accounts", () => {
    expect(DEFAULT_MOCK_ACCOUNT.address).toMatch(/^G[A-Z0-9]{55}$/);
    expect(DEFAULT_MOCK_ACCOUNT.network).toBe("TESTNET");

    expect(ALTERNATIVE_MOCK_ACCOUNT.address).toMatch(/^G[A-Z0-9]{55}$/);
    expect(ALTERNATIVE_MOCK_ACCOUNT.address).not.toEqual(
      DEFAULT_MOCK_ACCOUNT.address,
    );
  });

  it("initializes MockWalletProvider and executes connect / disconnect routines", async () => {
    const mockPage = {
      addInitScript: jest.fn(),
      getByTestId: jest.fn(() => ({
        isVisible: jest.fn().mockResolvedValue(true),
        click: jest.fn().mockResolvedValue(undefined),
      })),
      evaluate: jest.fn(),
    };

    const provider = new MockWalletProvider(
      mockPage as unknown as Parameters<typeof mockWalletConnect>[0],
    );
    await provider.connect(DEFAULT_MOCK_ACCOUNT);

    expect(mockPage.addInitScript).toHaveBeenCalledTimes(1);
    expect(mockPage.getByTestId).toHaveBeenCalledWith("connect-wallet-button");

    await provider.switchAccount(ALTERNATIVE_MOCK_ACCOUNT);
    expect(mockPage.evaluate).toHaveBeenCalledTimes(1);

    await provider.disconnect();
    expect(mockPage.getByTestId).toHaveBeenCalledWith(
      "wallet-connected-button",
    );
    expect(mockPage.getByTestId).toHaveBeenCalledWith("disconnect-wallet");
  });

  it("runs mockWalletConnect init script setup", async () => {
    const mockPage = {
      addInitScript: jest.fn(),
    };

    await mockWalletConnect(
      mockPage as unknown as Parameters<typeof mockWalletConnect>[0],
      DEFAULT_MOCK_ACCOUNT,
    );
    expect(mockPage.addInitScript).toHaveBeenCalledTimes(1);
  });
});
