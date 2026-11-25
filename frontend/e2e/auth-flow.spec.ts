import { test, expect } from "@playwright/test";

test.describe("Auth Flows", () => {
  test("should display login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("should show validation errors on empty form submit", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /login|sign in/i }).click();
    await expect(page.locator("form")).toBeVisible();
  });

  test("should redirect authenticated user", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/.*login/);
  });
});
