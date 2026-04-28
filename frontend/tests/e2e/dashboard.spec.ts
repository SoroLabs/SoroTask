import { test, expect } from '@playwright/test';

test.describe('SoroTask Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the dashboard with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Create Next App/); // Default title from layout.tsx
    await expect(page.locator('h1')).toContainText('SoroTask');
  });

  test('should show empty tasks state initially', async ({ page }) => {
    const emptyMessage = page.getByTestId('empty-tasks-message');
    await expect(emptyMessage).toBeVisible();
    await expect(emptyMessage).toContainText('No tasks registered yet');
  });

  test('should toggle wallet connection', async ({ page }) => {
    const connectBtn = page.getByTestId('connect-wallet-button');
    await expect(connectBtn).toContainText('Connect Wallet');
    
    await connectBtn.click();
    
    await expect(connectBtn).not.toContainText('Connect Wallet');
    await expect(connectBtn).toContainText('0x...');
  });

  test('should register a new automation task', async ({ page }) => {
    // Fill the form
    await page.getByTestId('target-contract-input').fill('CC1234567890ABCDEF');
    await page.getByTestId('function-name-input').fill('harvest_yield');
    await page.getByTestId('interval-input').fill('3600');
    await page.getByTestId('gas-balance-input').fill('50');
    
    // Submit
    await page.getByTestId('register-task-button').click();
    
    // Check if task appears in the list
    const taskItem = page.getByTestId('task-item');
    await expect(taskItem).toBeVisible();
    await expect(taskItem).toContainText('CC1234567890ABCDEF');
    await expect(taskItem).toContainText('harvest_yield');
    
    // Empty message should be gone
    await expect(page.getByTestId('empty-tasks-message')).not.toBeVisible();
  });

  test('should show validation errors if fields are missing', async ({ page }) => {
    // Click register without filling anything
    await page.getByTestId('register-task-button').click();
    
    // Check that no task was added
    await expect(page.getByTestId('task-item')).not.toBeVisible();
    await expect(page.getByTestId('empty-tasks-message')).toBeVisible();
    
    // Note: HTML5 validation prevents submission, so we just verify state hasn't changed
  });
});
