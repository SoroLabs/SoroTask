import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./frontend/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10000,
  },
  timeout: 30000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 12"] } },
  ],
  webServer: {
    command: "npm run dev --workspace frontend -- -p 3000",
    url: "http://localhost:3000",
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_E2E_MOCK_WALLET: "true",
      AUTH_SECRET: "test-secret-at-least-32-characters-long-for-authjs",
      NEXTAUTH_SECRET: "test-secret-at-least-32-characters-long-for-authjs",
      PORT: "3000",
    },
  },
});
