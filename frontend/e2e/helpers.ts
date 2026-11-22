import type { Page } from "@playwright/test";

export interface MockWalletAccount {
  address: string;
  publicKey: string;
  network: string;
}

export const DEFAULT_MOCK_ACCOUNT: MockWalletAccount = {
  address: "GA2C5RFPE6GCKMY3US5HHS6TDGNOQCH7S3CAVU2IQOOISTCYQTGG37C5",
  publicKey: "GA2C5RFPE6GCKMY3US5HHS6TDGNOQCH7S3CAVU2IQOOISTCYQTGG37C5",
  network: "TESTNET",
};

export const ALTERNATIVE_MOCK_ACCOUNT: MockWalletAccount = {
  address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  publicKey: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  network: "TESTNET",
};

export class MockWalletProvider {
  constructor(private page: Page) {}

  async connect(account: MockWalletAccount = DEFAULT_MOCK_ACCOUNT) {
    await this.page.addInitScript((acc) => {
      (window as unknown as Record<string, unknown>).__MOCK_WALLET__ = {
        address: acc.address,
        publicKey: acc.publicKey,
        connected: true,
        network: acc.network,
      };

      // Mock Freighter browser extension API
      (window as unknown as Record<string, unknown>).freighterApi = {
        isConnected: () => Promise.resolve(true),
        isAllowed: () => Promise.resolve(true),
        setAllowed: () => Promise.resolve(true),
        getPublicKey: () => Promise.resolve(acc.publicKey),
        getNetwork: () => Promise.resolve(acc.network),
        signTransaction: (xdr: string) => Promise.resolve(xdr),
        signAuthEntry: (entryXdr: string) => Promise.resolve(entryXdr),
      };
    }, account);

    const connectBtn = this.page.getByTestId("connect-wallet-button");
    if (await connectBtn.isVisible()) {
      await connectBtn.click();
    }
  }

  async disconnect() {
    const connectedBtn = this.page.getByTestId("wallet-connected-button");
    if (await connectedBtn.isVisible()) {
      await connectedBtn.click();
      await this.page.getByTestId("disconnect-wallet").click();
    }
  }

  async switchAccount(account: MockWalletAccount) {
    await this.page.evaluate((acc) => {
      (window as unknown as Record<string, unknown>).__MOCK_WALLET__ = {
        address: acc.address,
        publicKey: acc.publicKey,
        connected: true,
        network: acc.network,
      };
      window.dispatchEvent(
        new CustomEvent("stellar_wallet_account_changed", { detail: acc }),
      );
    }, account);
  }
}

export async function mockWalletConnect(
  page: Page,
  account: MockWalletAccount = DEFAULT_MOCK_ACCOUNT,
) {
  await page.addInitScript((acc) => {
    (window as unknown as Record<string, unknown>).__MOCK_WALLET__ = {
      address: acc.address,
      publicKey: acc.publicKey,
      connected: true,
      network: acc.network,
    };
    (window as unknown as Record<string, unknown>).freighterApi = {
      isConnected: () => Promise.resolve(true),
      isAllowed: () => Promise.resolve(true),
      getPublicKey: () => Promise.resolve(acc.publicKey),
      getNetwork: () => Promise.resolve(acc.network),
      signTransaction: (xdr: string) => Promise.resolve(xdr),
    };
  }, account);
}

export async function mockSorobanRpc(page: Page) {
  await page.route("**/soroban/rpc**", async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();

    if (postData?.method === "getHealth") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: postData.id,
          result: { status: "healthy" },
        }),
      });
      return;
    }

    if (postData?.method === "simulateTransaction") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: postData.id,
          result: {
            latestLedger: 123456,
            minResourceFee: "100",
            transactionData: "AAAAAgAAAA...",
          },
        }),
      });
      return;
    }

    await route.continue();
  });
}

export async function simulateNetworkDrop(page: Page) {
  await page.context().setOffline(true);
}

export async function restoreNetwork(page: Page) {
  await page.context().setOffline(false);
}

export async function openCommandPalette(page: Page) {
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
}

export async function searchCommand(page: Page, query: string) {
  const input = page.getByPlaceholder("Type a command or search...");
  await input.fill(query);
}

export async function selectFirstResult(page: Page) {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
}

export async function waitForDashboardReady(page: Page) {
  await page.waitForSelector('[data-testid="widget-volume"]', {
    timeout: 10000,
  });
}

export const TEST_USER = {
  email: "test@example.com",
  password: "TestPassword123!",
};
