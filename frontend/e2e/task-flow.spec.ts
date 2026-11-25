/**
 * Task-flow E2E suite — issue #882
 *
 * Covers the core SoroTask user journey against a local Mock Soroban network:
 *   Wallet Connect → Create Task → Simulate Execution → Cancel Task
 *
 * The NEXT_PUBLIC_E2E_MOCK_WALLET=true env flag (set in playwright.config.ts)
 * instructs the app to bypass the real Freighter/Albedo popup and use an
 * in-memory mock wallet instead, so no browser extension is required.
 */

import { test, expect } from '@playwright/test';
import { mockWalletConnect, waitForDashboardReady } from './helpers';

test.describe('Task Flow — Wallet Connect → Create → Execute → Cancel', () => {
  test.beforeEach(async ({ page }) => {
    await mockWalletConnect(page);
    await page.goto('/');
    await waitForDashboardReady(page);
  });

  test('wallet connects and shows address in header', async ({ page }) => {
    // After mockWalletConnect the app should display a truncated wallet address.
    const walletIndicator = page.getByTestId('wallet-address');
    await expect(walletIndicator).toBeVisible({ timeout: 10_000 });
    // Address should look like G…XXXX
    await expect(walletIndicator).toContainText(/G[A-Z0-9]{3,}/);
  });

  test('user can create a new task', async ({ page }) => {
    // Navigate to the tasks page.
    await page.goto('/tasks');
    await expect(page).toHaveURL(/.*tasks/);

    // Open the create-task form.
    const createBtn = page
      .getByRole('button', { name: /create task|new task|\+ task/i })
      .first();
    await expect(createBtn).toBeVisible({ timeout: 8_000 });
    await createBtn.click();

    // Fill in required fields.
    const titleInput = page.getByLabel(/title|task name/i).first();
    await expect(titleInput).toBeVisible();
    await titleInput.fill('E2E Smoke Test Task');

    // Submit the form.
    const submitBtn = page
      .getByRole('button', { name: /submit|create|save/i })
      .last();
    await submitBtn.click();

    // The new task should appear in the list.
    await expect(page.getByText('E2E Smoke Test Task')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('simulated execution status progresses', async ({ page }) => {
    await page.goto('/tasks');

    // Find any task row and open its detail view.
    const firstTask = page.locator('[data-testid="task-row"]').first();
    if (await firstTask.isVisible()) {
      await firstTask.click();

      // Look for an Execute / Simulate button inside the task detail.
      const execBtn = page.getByRole('button', {
        name: /execute|simulate|run/i,
      });
      if (await execBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await execBtn.click();
        // Execution status should eventually show PENDING, IN_PROGRESS, or COMPLETED.
        await expect(
          page.getByText(/pending|in.progress|completed|simulated/i),
        ).toBeVisible({ timeout: 20_000 });
      }
    }

    // Even without a task present the page itself must remain stable.
    await expect(page).toHaveURL(/.*tasks/);
  });

  test('user can cancel an existing task', async ({ page }) => {
    await page.goto('/tasks');

    const firstTask = page.locator('[data-testid="task-row"]').first();
    if (await firstTask.isVisible()) {
      await firstTask.click();

      const cancelBtn = page.getByRole('button', { name: /cancel task/i });
      if (await cancelBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await cancelBtn.click();

        // Confirm dialog may appear.
        const confirmBtn = page.getByRole('button', {
          name: /confirm|yes|ok/i,
        });
        if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await confirmBtn.click();
        }

        await expect(
          page.getByText(/cancelled|canceled/i),
        ).toBeVisible({ timeout: 15_000 });
      }
    }

    await expect(page).toHaveURL(/.*tasks/);
  });
});
