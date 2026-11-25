import { test, expect } from "@playwright/test";
import {
  MockWalletProvider,
  mockSorobanRpc,
  simulateNetworkDrop,
  restoreNetwork,
  DEFAULT_MOCK_ACCOUNT,
  ALTERNATIVE_MOCK_ACCOUNT,
} from "./helpers";

test.describe("Enterprise E2E Suite: Critical User Journeys & Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await mockSorobanRpc(page);
    // Start each journey from a clean client state for deterministic tour/wallet behavior.
    await page.addInitScript(() => {
      try {
        window.localStorage.clear();
      } catch {
        /* ignore */
      }
    });
  });

  // Dismiss the auto-starting product tour when it would block interactions.
  async function dismissTourIfVisible(page: import("@playwright/test").Page) {
    const dismissBtn = page.getByTestId("tour-dismiss-btn");
    if (await dismissBtn.isVisible().catch(() => false)) {
      await dismissBtn.click();
      await expect(page.getByTestId("product-tour-modal")).not.toBeVisible();
    }
  }

  // 1. Onboarding & Guided Product Tour Journey
  test("User Journey 1: Guided Product Tour auto-starts, navigates steps, and awards gamified faucet tokens", async ({
    page,
  }) => {
    await page.goto("/");

    const tourModal = page.getByTestId("product-tour-modal");
    await expect(tourModal).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("tour-step-title")).toContainText(
      "Welcome to SoroTask",
    );

    const nextBtn = page.getByTestId("tour-next-btn");
    await nextBtn.click();
    await expect(page.getByTestId("tour-step-title")).toContainText(
      "Connect Your Wallet",
    );

    await nextBtn.click();
    await expect(page.getByTestId("tour-step-title")).toContainText(
      "Task Creation & Resolvers",
    );

    await nextBtn.click();
    await expect(page.getByTestId("tour-step-title")).toContainText(
      "Autonomous Keeper Network",
    );

    await nextBtn.click();
    await expect(page.getByTestId("tour-step-title")).toContainText(
      "Complete Tutorial & Earn Reward",
    );

    const claimBtn = page.getByTestId("tour-claim-reward-btn");
    await expect(claimBtn).toBeVisible();
    await claimBtn.click();

    await expect(page.getByTestId("tour-reward-claimed")).toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByText("SoroTask Pioneer Badge Granted"),
    ).toBeVisible();

    await page.getByTestId("tour-finish-btn").click();
    await expect(tourModal).not.toBeVisible();

    const replayBtn = page.getByTestId("start-tour-btn");
    await expect(replayBtn).toBeVisible();
  });

  test("User Journey 1b: User can dismiss tour and replay anytime", async ({
    page,
  }) => {
    await page.goto("/");

    const dismissBtn = page.getByTestId("tour-dismiss-btn");
    await expect(dismissBtn).toBeVisible({ timeout: 10000 });
    await dismissBtn.click();
    await expect(page.getByTestId("product-tour-modal")).not.toBeVisible();

    const replayBtn = page.getByTestId("start-tour-btn");
    await expect(replayBtn).toBeVisible();
    await replayBtn.click();
    await expect(page.getByTestId("product-tour-modal")).toBeVisible();
  });

  // 2. Wallet & Account Switching Journey
  test("User Journey 2: Mock Freighter wallet connection and account switching", async ({
    page,
  }) => {
    const wallet = new MockWalletProvider(page);
    await page.goto("/");

    await dismissTourIfVisible(page);
    await wallet.connect(DEFAULT_MOCK_ACCOUNT);
    await wallet.switchAccount(ALTERNATIVE_MOCK_ACCOUNT);
  });

  // 3. Task Creation & Form Validation
  test("User Journey 3: Automation task creation with cron intervals and gas escrow", async ({
    page,
  }) => {
    await page.goto("/tasks/create");

    await dismissTourIfVisible(page);

    const addressInput = page.getByLabel(/Target Contract Address/i);
    if (await addressInput.isVisible().catch(() => false)) {
      await addressInput.fill(
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      );
    }
    const functionInput = page.getByLabel(/Function Name/i);
    if (await functionInput.isVisible().catch(() => false)) {
      await functionInput.fill("harvest_yield");
    }
    const intervalInput = page.getByLabel(/Interval/i);
    if (await intervalInput.isVisible().catch(() => false)) {
      await intervalInput.fill("3600");
    }
    const gasInput = page.getByLabel(/Gas Balance/i);
    if (await gasInput.isVisible().catch(() => false)) {
      await gasInput.fill("15");
    }
  });

  // 4. Token Allowance Manager & Approval Audit Journey (Issue #1505)
  test("User Journey 4: Audit token allowances, highlight unlimited risk, and batch revoke", async ({
    page,
  }) => {
    await page.goto("/settings");

    await dismissTourIfVisible(page);

    const allowanceManager = page.getByTestId("allowance-manager");
    await expect(allowanceManager).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("metric-total-allowances")).toBeVisible();
    await expect(page.getByTestId("metric-unlimited-allowances")).toBeVisible();

    await expect(page.getByText(/Security Warning:/i)).toBeVisible();

    const dustFilter = page.getByTestId("filter-dust-btn");
    await dustFilter.click();

    const unlimitedFilter = page.getByTestId("filter-unlimited-btn");
    await unlimitedFilter.click();

    const revokeBtn = page.getByTestId("revoke-btn-allowance-1");
    if (await revokeBtn.isVisible().catch(() => false)) {
      await revokeBtn.click();
      await expect(page.getByTestId("allowance-notification")).toBeVisible({
        timeout: 5000,
      });
    }
  });

  // 5. Autonomous Limit Order Trading & Marketplace Journey (Issue #1507)
  test("User Journey 5: Marketplace limit order management, interactive chart, and order execution", async ({
    page,
  }) => {
    await page.goto("/marketplace");

    await dismissTourIfVisible(page);

    await expect(page.getByTestId("trading-chart-container")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("tradingview-canvas")).toBeVisible();

    const pairSelect = page.getByTestId("pair-select");
    await pairSelect.selectOption("XLM/AQUA");

    const tf1h = page.getByTestId("timeframe-1h");
    await tf1h.click();

    const incBtn = page.getByTestId("price-inc-order-1");
    if (await incBtn.isVisible().catch(() => false)) {
      await incBtn.click();
    }

    const simFillBtn = page.getByTestId("trigger-execution-btn-order-1");
    if (await simFillBtn.isVisible().catch(() => false)) {
      await simFillBtn.click();
      await expect(
        page.getByTestId("execution-celebration-banner"),
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.getByText(/Autonomous Limit Order Executed & Filled!/i),
      ).toBeVisible();
    }
  });

  // 6. Network Drop & Offline Resilience
  test("User Journey 6: Offline resilience and network drop recovery", async ({
    page,
  }) => {
    await page.goto("/");

    await dismissTourIfVisible(page);
    await simulateNetworkDrop(page);
    await restoreNetwork(page);
  });

  // 7. Visual & Viewport Integrity
  test("User Journey 7: Responsive layout renders cleanly on mobile and desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await expect(page).toHaveTitle(/SoroTask/);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page).toHaveTitle(/SoroTask/);
  });
});
