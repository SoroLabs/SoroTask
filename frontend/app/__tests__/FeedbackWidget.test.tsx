import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FeedbackWidget } from "@/src/components/FeedbackWidget";
import { telemetry } from "@/src/lib/telemetry";
import { WalletProvider } from "@/app/context/WalletContext";

describe("FeedbackWidget & Telemetry", () => {
  it("redacts sensitive keywords from diagnostic reports", () => {
    const rawReport: any = {
      title: "Error report with secret_key=S1234567890",
      description: "My private_key was exposed and auth_token was leaked",
      severity: "critical",
      category: "bug",
      browser: {
        userAgent: "Jest",
        language: "en",
        url: "http://localhost",
        timestamp: new Date().toISOString(),
        onlineStatus: true,
      },
      consoleLogs: ["[LOG] secret=TOP_SECRET_123"],
      networkErrors: [],
    };

    const sanitized = telemetry.redactSensitiveData(rawReport);
    expect(JSON.stringify(sanitized)).not.toContain("S1234567890");
    expect(JSON.stringify(sanitized)).not.toContain("TOP_SECRET_123");
    expect(JSON.stringify(sanitized)).toContain("[REDACTED]");
  });

  it("renders trigger button and opens modal on click", () => {
    render(
      <WalletProvider>
        <FeedbackWidget />
      </WalletProvider>
    );

    const btn = screen.getByRole("button", { name: /Report Bug \/ Feedback/i });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.getByText(/Automated Bug Reporter/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. Transaction estimation failed on Testnet/i)).toBeInTheDocument();
  });
});
