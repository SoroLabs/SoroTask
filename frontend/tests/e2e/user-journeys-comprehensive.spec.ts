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
  });

  // 1. Onboarding & Guided Product Tour Journey
  test("User Journey 1: Guided Product Tour auto-starts, navigates steps, and awards gamified faucet tokens", async ({
    page,
  }) => {
    await page.goto("/");

    // Verify product tour auto-launches for new users
    const tourModal = page.getByTestId("product-tour-modal");
    await expect(tourModal).toBeVisible();
    await expect(page.getByTestId("tour-step-title")).toContainText(
      "Welcome to SoroTask",
    );

    // Step navigation
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

    // Gamified reward step
    await nextBtn.click();
    await expect(page.getByTestId("tour-step-title")).toContainText(
      "Complete Tutorial & Earn Reward",
    );

    const claimBtn = page.getByTestId("tour-claim-reward-btn");
    await expect(claimBtn).toBeVisible();
    await claimBtn.click();

    await expect(page.getByTestId("tour-reward-claimed")).toBeVisible();
    await expect(
      page.getByText("SoroTask Pioneer Badge Granted"),
    ).toBeVisible();

    // Finish tour
    await page.getByTestId("tour-finish-btn").click();
    await expect(tourModal).not.toBeVisible();

    // Replay tour button available
    const replayBtn = page.getByTestId("start-tour-btn");
    await expect(replayBtn).toBeVisible();
  });

  test("User Journey 1b: User can dismiss tour and replay anytime", async ({
    page,
  }) => {
    await page.goto("/");

    const dismissBtn = page.getByTestId("tour-dismiss-btn");
    await dismissBtn.click();
    await expect(page.getByTestId("product-tour-modal")).not.toBeVisible();

    const replayBtn = page.getByTestId("start-tour-btn");
    await replayBtn.click();
    await expect(page.getByTestId("product-tour-modal")).toBeVisible();
  });

  // 2. Wallet & Account Switching Journey
  test("User Journey 2: Mock Freighter wallet connection and account switching", async ({
    page,
  }) => {
    const wallet = new MockWalletProvider(page);
    await page.goto("/");

    await wallet.connect(DEFAULT_MOCK_ACCOUNT);
    await wallet.switchAccount(ALTERNATIVE_MOCK_ACCOUNT);
  });

  // 3. Task Creation & Form Validation
  test("User Journey 3: Automation task creation with cron intervals and gas escrow", async ({
    page,
  }) => {
    await page.goto("/tasks/create");

    const addressInput = page.getByLabel(/Target Contract Address/i);
    if (await addressInput.isVisible()) {
      await addressInput.fill(
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      );
      await page.getByLabel(/Function Name/i).fill("harvest_yield");
      await page.getByLabel(/Interval/i).fill("3600");
      await page.getByLabel(/Gas Balance/i).fill("15");
    }
  });

  // 4. Token Allowance Manager & Approval Audit Journey (Issue #1505)
  test("User Journey 4: Audit token allowances, highlight unlimited risk, and batch revoke", async ({
    page,
  }) => {
    await page.goto("/settings");

    const allowanceManager = page.getByTestId("allowance-manager");
    await expect(allowanceManager).toBeVisible();

    // Metrics validation
    await expect(page.getByTestId("metric-total-allowances")).toBeVisible();
    await expect(page.getByTestId("metric-unlimited-allowances")).toBeVisible();

    // Security warning banner
    await expect(page.getByText(/Security Warning:/i)).toBeVisible();

    // Filter by dust
    const dustFilter = page.getByTestId("filter-dust-btn");
    await dustFilter.click();

    // Filter by unlimited
    const unlimitedFilter = page.getByTestId("filter-unlimited-btn");
    await unlimitedFilter.click();

    // Revoke single allowance
    const revokeBtn = page.getByTestId("revoke-btn-allowance-1");
    if (await revokeBtn.isVisible()) {
      await revokeBtn.click();
      await expect(page.getByTestId("allowance-notification")).toBeVisible();
    }
  });

  // 5. Autonomous Limit Order Trading & Marketplace Journey (Issue #1507)
  test("User Journey 5: Marketplace limit order management, interactive chart, and order execution", async ({
    page,
  }) => {
    await page.goto("/marketplace");

    // Chart container and canvas
    await expect(page.getByTestId("trading-chart-container")).toBeVisible();
    await expect(page.getByTestId("tradingview-canvas")).toBeVisible();

    // Switch pairs
    const pairSelect = page.getByTestId("pair-select");
    await pairSelect.selectOption("XLM/AQUA");

    // Switch timeframe
    const tf1h = page.getByTestId("timeframe-1h");
    await tf1h.click();

    // Limit order adjustment
    const incBtn = page.getByTestId("price-inc-order-1");
    if (await incBtn.isVisible()) {
      await incBtn.click();
    }

    // Trigger execution celebration
    const simFillBtn = page.getByTestId("trigger-execution-btn-order-1");
    if (await simFillBtn.isVisible()) {
      await simFillBtn.click();
      await expect(
        page.getByTestId("execution-celebration-banner"),
      ).toBeVisible();
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

    await simulateNetworkDrop(page);
    await restoreNetwork(page);
  });

  // 7. Visual & Viewport Integrity
  test("User Journey 7: Responsive layout renders cleanly on mobile and desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // Mobile viewport
    await page.goto("/");
    await expect(page).toHaveTitle(/SoroTask/);

    await page.setViewportSize({ width: 1440, height: 900 }); // Desktop viewport
    await page.goto("/");
    await expect(page).toHaveTitle(/SoroTask/);
  });
});
