import { expect, test } from '@playwright/test';
import { MockWalletProvider } from './helpers';

const VALID_CONTRACT_ADDRESS = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function dismissTourIfVisible(page: import('@playwright/test').Page) {
  const dismissBtn = page.getByTestId('tour-dismiss-btn');
  if (await dismissBtn.isVisible().catch(() => false)) {
    await dismissBtn.click();
    await expect(page.getByTestId('product-tour-modal')).not.toBeVisible();
  }
}

test.describe('SoroTask critical paths', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tasks/create');
    await dismissTourIfVisible(page);
  });

  test('homepage shows correct title', async ({ page }) => {
    await page.goto('/');
    await dismissTourIfVisible(page);
    await expect(page).toHaveTitle(/SoroTask/);
  });

  test('wallet connection modal opens', async ({ page }) => {
    const connectBtn = page.getByTestId('connect-wallet-button');
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();
    await expect(page.getByTestId('wallet-modal')).toBeVisible();
  });

  test('connects a mock wallet', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Create Automation Task' })).toBeVisible();
    const connectBtn = page.getByTestId('connect-wallet-button');
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();
    await expect(page.getByTestId('wallet-connected-button')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('wallet-connected-button')).toContainText('Futurenet');
  });

  test('fills out and submits the task creation form', async ({ page }) => {
    const connectBtn = page.getByTestId('connect-wallet-button');
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();
    await expect(page.getByTestId('wallet-connected-button')).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Target Contract Address').fill(VALID_CONTRACT_ADDRESS);
    await page.getByLabel('Function Name').fill('harvest_yield');
    await page.getByLabel('Interval (seconds)').fill('3600');
    await page.getByLabel('Gas Balance (XLM)').fill('10');

    const registerButton = page.getByRole('button', { name: /Register Task/i });
    await expect(registerButton).toBeEnabled();
    await registerButton.click();

    await expect(page.getByText('Task created successfully!')).toBeVisible();
  });
});
