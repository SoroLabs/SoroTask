import { telemetry } from "./telemetry";

describe("telemetry privacy filtering", () => {
  const walletAddress = `G${"A".repeat(55)}`;

  it("redacts wallet addresses, balances, and credentials from reports", () => {
    const report = telemetry.redactSensitiveData({
      title: `Wallet ${walletAddress} balance 123.45 XLM`,
      description: "secret_key=do-not-send",
      severity: "high",
      category: "transaction",
      walletAddress,
      browser: {
        userAgent: "test",
        language: "en",
        url: `https://app.example/tasks/${walletAddress}?token=do-not-send`,
        timestamp: new Date(0).toISOString(),
        screenResolution: "320x640",
        onlineStatus: true,
      },
      consoleLogs: [`failed for ${walletAddress}`],
      networkErrors: [
        {
          url: `https://rpc.example/${walletAddress}?api_key=do-not-send`,
          status: 400,
          error: `balance 99 XLM for ${walletAddress}`,
          timestamp: 1,
        },
      ],
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(walletAddress);
    expect(serialized).not.toContain("123.45");
    expect(serialized).not.toContain("do-not-send");
    expect(report.walletAddress).toBe("[REDACTED]");
    expect(report.networkErrors[0].status).toBe(400);
  });

  it("records sanitized client and network errors in bounded snapshots", () => {
    telemetry.recordConsole("ERROR", [`wallet ${walletAddress}`]);
    telemetry.recordNetworkError(
      `https://rpc.example/${walletAddress}?token=private`,
      500,
      `gas balance 10 XLM for ${walletAddress}`,
    );

    expect(telemetry.captureConsoleSnapshot(1).join()).not.toContain(walletAddress);
    expect(JSON.stringify(telemetry.captureNetworkErrors())).not.toContain(
      walletAddress,
    );
  });
});
