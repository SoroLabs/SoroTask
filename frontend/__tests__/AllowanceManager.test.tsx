import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AllowanceManager } from "@/src/components/AllowanceManager";

// Mock StellarWalletContext
jest.mock("@/context/StellarWalletContext", () => ({
  useStellarWallet: () => ({
    address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    isConnected: true,
    network: "TESTNET",
  }),
}));

describe("AllowanceManager Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the AllowanceManager component with header and metrics", () => {
    render(<AllowanceManager />);

    expect(screen.getByTestId("allowance-manager")).toBeInTheDocument();
    expect(
      screen.getByText("Token Allowances & Approval Manager"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("metric-total-allowances")).toHaveTextContent(
      "5",
    );
    expect(screen.getByTestId("metric-unlimited-allowances")).toHaveTextContent(
      "3",
    );
    expect(screen.getByTestId("metric-dust-allowances")).toHaveTextContent("2");
  });

  it("displays security warning alert when unlimited allowances exist", () => {
    render(<AllowanceManager />);

    expect(screen.getByText(/Security Warning:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/3 unlimited token allowance\(s\)/i),
    ).toBeInTheDocument();
  });

  it("filters allowances by unlimited risk grants", () => {
    render(<AllowanceManager />);

    const unlimitedFilterBtn = screen.getByTestId("filter-unlimited-btn");
    fireEvent.click(unlimitedFilterBtn);

    // Should only show the 3 unlimited allowances: XLM, USDC, OLD-LP
    expect(screen.getByTestId("allowance-row-allowance-1")).toBeInTheDocument();
    expect(screen.getByTestId("allowance-row-allowance-2")).toBeInTheDocument();
    expect(screen.getByTestId("allowance-row-allowance-5")).toBeInTheDocument();
    expect(
      screen.queryByTestId("allowance-row-allowance-3"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("allowance-row-allowance-4"),
    ).not.toBeInTheDocument();
  });

  it("filters allowances by dust token approvals", () => {
    render(<AllowanceManager />);

    const dustFilterBtn = screen.getByTestId("filter-dust-btn");
    fireEvent.click(dustFilterBtn);

    // Dust tokens: AQUA and OLD-LP
    expect(screen.getByTestId("allowance-row-allowance-3")).toBeInTheDocument();
    expect(screen.getByTestId("allowance-row-allowance-5")).toBeInTheDocument();
    expect(
      screen.queryByTestId("allowance-row-allowance-1"),
    ).not.toBeInTheDocument();
  });

  it("filters allowances by search term", () => {
    render(<AllowanceManager />);

    const searchInput = screen.getByTestId("search-allowances-input");
    fireEvent.change(searchInput, { target: { value: "Aquarius" } });

    expect(screen.getByTestId("allowance-row-allowance-3")).toBeInTheDocument();
    expect(
      screen.queryByTestId("allowance-row-allowance-1"),
    ).not.toBeInTheDocument();
  });

  it("revokes a single token allowance on-chain", async () => {
    render(<AllowanceManager />);

    const revokeBtn = screen.getByTestId("revoke-btn-allowance-1");
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(screen.getByTestId("allowance-notification")).toHaveTextContent(
        /Successfully reset XLM allowance to 0 on-chain/i,
      );
    });

    expect(
      screen.queryByTestId("allowance-row-allowance-1"),
    ).not.toBeInTheDocument();
  });

  it("supports selecting multiple allowances and batch revoking them", async () => {
    render(<AllowanceManager />);

    const selectAllCheckbox = screen.getByLabelText("Select all allowances");
    fireEvent.click(selectAllCheckbox);

    const batchRevokeBtn = screen.getByTestId("batch-revoke-btn");
    expect(batchRevokeBtn).toHaveTextContent("Revoke Selected (5)");
    fireEvent.click(batchRevokeBtn);

    await waitFor(() => {
      expect(screen.getByTestId("allowance-notification")).toHaveTextContent(
        /Successfully executed batch revocation: 5 token allowances reset to 0/i,
      );
    });

    expect(
      screen.getByText(/Your wallet approvals are clean!/i),
    ).toBeInTheDocument();
  });

  it("executes emergency revoke-all for all allowances", async () => {
    render(<AllowanceManager />);

    const emergencyBtn = screen.getByTestId("emergency-revoke-all-btn");
    fireEvent.click(emergencyBtn);

    await waitFor(() => {
      expect(screen.getByTestId("allowance-notification")).toHaveTextContent(
        /All token approvals and allowances have been reset to 0/i,
      );
    });

    expect(screen.getByTestId("metric-total-allowances")).toHaveTextContent(
      "0",
    );
  });
});
