import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ApiKeyManager,
  validateIpOrCidr,
  generateCryptographicApiKey,
  ApiKey,
} from "../ApiKeyManager";

describe("ApiKeyManager Component and Utilities", () => {
  const mockKeys: ApiKey[] = [
    {
      id: "test-key-1",
      name: "Test Keeper Key",
      maskedKey: "sk_live_••••••••••••••••1234",
      scopes: ["read:tasks", "trigger:executions"],
      ipWhitelist: ["192.168.1.50"],
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-02T12:00:00.000Z",
      status: "active",
      quota: {
        limitPerMonth: 50000,
        usedThisMonth: 10000,
        rateLimitPerMinute: 60,
      },
    },
  ];

  describe("validateIpOrCidr", () => {
    it("validates single IPv4 addresses", () => {
      expect(validateIpOrCidr("192.168.1.1")).toBe(true);
      expect(validateIpOrCidr("10.0.0.1")).toBe(true);
      expect(validateIpOrCidr("256.0.0.1")).toBe(false);
      expect(validateIpOrCidr("invalid")).toBe(false);
    });

    it("validates IPv4 CIDR blocks", () => {
      expect(validateIpOrCidr("192.168.1.0/24")).toBe(true);
      expect(validateIpOrCidr("10.0.0.0/8")).toBe(true);
      expect(validateIpOrCidr("172.16.0.0/16")).toBe(true);
      expect(validateIpOrCidr("10.0.0.0/33")).toBe(false);
    });

    it("validates IPv6 / CIDR notation", () => {
      expect(validateIpOrCidr("2001:db8::/32")).toBe(true);
      expect(validateIpOrCidr("::1")).toBe(true);
    });
  });

  describe("generateCryptographicApiKey", () => {
    it("generates a key starting with sk_live_ and corresponding masked version", () => {
      const { secretKey, maskedKey } = generateCryptographicApiKey();
      expect(secretKey).toMatch(/^sk_live_[0-9a-f]{48}$/);
      expect(maskedKey).toMatch(/^sk_live_•{16}[0-9a-f]{4}$/);
      expect(secretKey.slice(-4)).toEqual(maskedKey.slice(-4));
    });
  });

  describe("Component Rendering & Interactions", () => {
    it("renders API keys list with masked keys and scopes", () => {
      render(<ApiKeyManager initialKeys={mockKeys} />);

      expect(screen.getByText("Developer API Keys")).toBeInTheDocument();
      expect(screen.getByText("Test Keeper Key")).toBeInTheDocument();
      expect(
        screen.getByText("sk_live_••••••••••••••••1234"),
      ).toBeInTheDocument();
      expect(screen.getByText("read:tasks")).toBeInTheDocument();
      expect(screen.getByText("trigger:executions")).toBeInTheDocument();
      expect(screen.getByText("192.168.1.50")).toBeInTheDocument();
    });

    it("filters keys by search query", () => {
      render(<ApiKeyManager initialKeys={mockKeys} />);

      const searchInput = screen.getByPlaceholderText(/Search by key name/i);
      fireEvent.change(searchInput, { target: { value: "Non-existent" } });

      expect(screen.getByText(/No API keys found/i)).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: "Keeper" } });
      expect(screen.getByText("Test Keeper Key")).toBeInTheDocument();
    });

    it("opens create modal, allows scope and IP input, and reveals secret key once", async () => {
      const onKeyCreated = jest.fn();
      render(
        <ApiKeyManager initialKeys={mockKeys} onKeyCreated={onKeyCreated} />,
      );

      const generateBtn = screen.getByRole("button", {
        name: /Generate New Key/i,
      });
      fireEvent.click(generateBtn);

      expect(
        screen.getByText("Generate Developer API Key"),
      ).toBeInTheDocument();

      const nameInput = screen.getByPlaceholderText(
        /e\.g\. Yield Arbitrage Keeper Bot/i,
      );
      fireEvent.change(nameInput, { target: { value: "Arbitrage Bot v2" } });

      // Add IP to whitelist
      const ipInput = screen.getByPlaceholderText(
        /192.168.1.1 or 10.0.0.0\/24/i,
      );
      fireEvent.change(ipInput, { target: { value: "10.50.0.0/16" } });
      const addIpBtn = screen.getByRole("button", { name: /Add IP/i });
      fireEvent.click(addIpBtn);

      expect(screen.getByText("10.50.0.0/16")).toBeInTheDocument();

      // Submit creation
      const submitBtn = screen.getByRole("button", { name: /Create API Key/i });
      fireEvent.submit(submitBtn.closest("form")!);

      // Secret Key reveal modal should appear
      await waitFor(() => {
        expect(
          screen.getByText("Save Your Secret API Key"),
        ).toBeInTheDocument();
      });

      const secretKeyDisplay = screen.getByTestId(
        "secret-key-display",
      ) as HTMLInputElement;
      expect(secretKeyDisplay.value).toMatch(/^sk_live_/);

      expect(screen.getByText(/This secret key will/i)).toBeInTheDocument();

      // Copy secret key
      const copyBtn = screen.getByTestId("copy-secret-key-button");
      fireEvent.click(copyBtn);
      expect(screen.getByText("Copied!")).toBeInTheDocument();

      // Close reveal modal
      const closeBtn = screen.getByTestId("close-reveal-modal");
      fireEvent.click(closeBtn);

      expect(
        screen.queryByText("Save Your Secret API Key"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Arbitrage Bot v2")).toBeInTheDocument();
      expect(onKeyCreated).toHaveBeenCalledTimes(1);
    });

    it("revokes key instantly upon clicking revoke", async () => {
      const onKeyRevoked = jest.fn();
      render(
        <ApiKeyManager initialKeys={mockKeys} onKeyRevoked={onKeyRevoked} />,
      );

      const revokeBtn = screen.getByRole("button", { name: /Revoke Key/i });
      fireEvent.click(revokeBtn);

      await waitFor(() => {
        expect(screen.getByText("Revoked")).toBeInTheDocument();
      });

      expect(onKeyRevoked).toHaveBeenCalledWith("test-key-1");
      expect(
        screen.getByText(/API key revoked successfully/i),
      ).toBeInTheDocument();
    });
  });
});
