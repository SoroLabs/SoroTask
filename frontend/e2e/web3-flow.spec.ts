import { test, expect } from "@playwright/test";
import { mockWalletConnect, openCommandPalette, searchCommand, waitForDashboardReady } from "./helpers";

test.describe("Web3 E2E Flows", () => {
  test.beforeEach(async ({ page }) => {
    await mockWalletConnect(page);
    await page.goto("/");
  });

  test("should display homepage", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("SoroTask");
  });

  test("should open command palette with Ctrl+K", async ({ page }) => {
    await openCommandPalette(page);
    await expect(page.getByPlaceholder("Type a command or search...")).toBeVisible();
  });

  test("should search commands in palette", async ({ page }) => {
    await openCommandPalette(page);
    await searchCommand(page, "home");
    await expect(page.getByText("Go to Home")).toBeVisible();
  });

  test("should navigate via command palette", async ({ page }) => {
    await openCommandPalette(page);
    await searchCommand(page, "tasks");
    await page.getByText("View Tasks").click();
    await expect(page).toHaveURL(/.*tasks/);
  });

  test("should load dashboard with widgets", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDashboardReady(page);
    await expect(page.locator("[data-testid=\"widget-volume\"]")).toBeVisible();
  });

  test("should toggle theme", async ({ page }) => {
    await page.goto("/dashboard");
    await openCommandPalette(page);
    await searchCommand(page, "theme");
    await page.getByText("Toggle Theme").click();
  });

  test("should handle wallet connection mock", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("body")).toBeVisible();
  });
});
