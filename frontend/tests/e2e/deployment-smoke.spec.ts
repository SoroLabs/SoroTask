import { expect, test } from "@playwright/test";

test("deployed task page loads and completes the wallet connection flow", async ({
  page,
}) => {
  const deploymentURL = process.env.PLAYWRIGHT_BASE_URL;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  if (deploymentURL && bypassSecret) {
    const deploymentOrigin = new URL(deploymentURL).origin;
    await page.route("**/*", async (route) => {
      const requestURL = new URL(route.request().url());
      if (requestURL.origin === deploymentOrigin) {
        await route.continue({
          headers: {
            ...route.request().headers(),
            "x-vercel-protection-bypass": bypassSecret,
          },
        });
        return;
      }

      await route.continue();
    });
  }

  await page.addInitScript((address) => {
    Object.defineProperty(window, "freighter", {
      configurable: true,
      value: true,
    });

    window.addEventListener("message", (event) => {
      const request = event.data as {
        messageId?: number;
        source?: string;
        type?: string;
      };
      if (request.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;

      const response: Record<string, unknown> = {
        source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
        messagedId: request.messageId,
      };

      if (
        request.type === "REQUEST_ACCESS" ||
        request.type === "REQUEST_PUBLIC_KEY"
      ) {
        response.publicKey = address;
      } else if (request.type === "REQUEST_NETWORK_DETAILS") {
        response.networkDetails = {
          network: "Futurenet",
          networkUrl: "https://horizon-futurenet.stellar.org",
          networkPassphrase: "Test SDF Future Network ; October 2022",
          sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
        };
      } else if (request.type === "REQUEST_CONNECTION_STATUS") {
        response.isConnected = true;
      } else if (request.type === "SET_ALLOWED_STATUS") {
        response.isAllowed = true;
      }

      window.postMessage(response, window.location.origin);
    });
  }, "GA2C5RFPE6GCKMY3US5HHS6TDGNOQCH7S3CAVU2IQOOISTCYQTGG37C5");

  const staticAssetResponse = deploymentURL
    ? page.waitForResponse(
        (asset) =>
          asset.url().includes("/_next/static/") && asset.status() === 200,
      )
    : undefined;
  const response = await page.goto("/tasks/create");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Create Automation Task" }),
  ).toBeVisible();
  if (staticAssetResponse) {
    const staticAsset = await staticAssetResponse;
    expect(staticAsset.headers()["cache-control"]).toContain("immutable");
  }

  const connectButton = page.getByTestId("connect-wallet-button");
  await expect(connectButton).toBeVisible();
  await expect(connectButton).toBeEnabled();
  await connectButton.click();

  const connectedState = page.getByTestId("wallet-connected-button");
  await expect(connectedState).toBeVisible({ timeout: 10_000 });
  await expect(connectedState).toHaveAttribute(
    "aria-label",
    /Wallet connected: GA2C5RF/,
  );
});
