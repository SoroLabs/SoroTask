import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  StorageInspector,
  calculateRemainingBlocks,
  calculateRemainingDays,
  getTtlHealthCategory,
  BLOCKS_PER_DAY,
} from "../StorageInspector";

describe("StorageInspector Component & Calculations", () => {
  it("calculates remaining blocks and days accurately", () => {
    const liveUntil = 51_017_280;
    const current = 51_000_000;
    const blocks = calculateRemainingBlocks(liveUntil, current);
    expect(blocks).toBe(17_280);

    const days = calculateRemainingDays(liveUntil, current);
    expect(days).toBeCloseTo(1.0, 2);
  });

  it("categorizes health risk colors accurately based on expiration thresholds", () => {
    // Green > 30 days
    expect(getTtlHealthCategory(45).color).toBe("green");
    // Yellow < 30 days and >= 2 days
    expect(getTtlHealthCategory(15).color).toBe("yellow");
    expect(getTtlHealthCategory(5).color).toBe("yellow");
    // Red < 2 days
    expect(getTtlHealthCategory(1.5).color).toBe("red");
    expect(getTtlHealthCategory(0.5).color).toBe("red");
  });

  it("renders storage keys, categories, and highlights critical expiring entries", () => {
    render(
      <StorageInspector
        contractId="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
        currentLedger={51_000_000}
      />,
    );

    expect(
      screen.getByText("Contract Storage & TTL Inspector"),
    ).toBeInTheDocument();
    expect(screen.getByText("AdminAddress")).toBeInTheDocument();
    expect(screen.getByText("TaskNonce:user_01")).toBeInTheDocument();
    expect(screen.getByText("RateLimitWindow:user_01")).toBeInTheDocument();

    // Critical badge is rendered
    expect(screen.getByTestId("critical-badge")).toBeInTheDocument();
  });

  it("filters entries by storage type", () => {
    render(<StorageInspector currentLedger={51_000_000} />);

    // Click Temporary filter
    const tempBtn = screen.getByRole("button", { name: "Temporary" });
    fireEvent.click(tempBtn);

    expect(screen.getByText("RateLimitWindow:user_01")).toBeInTheDocument();
    expect(screen.queryByText("AdminAddress")).not.toBeInTheDocument();
  });

  it("triggers onBumpTtl callback cleanly when extend button is clicked", async () => {
    const mockBump = jest.fn().mockResolvedValue(true);
    render(
      <StorageInspector currentLedger={51_000_000} onBumpTtl={mockBump} />,
    );

    const bumpBtn = screen.getByTestId("bump-btn-AdminAddress");
    fireEvent.click(bumpBtn);

    await waitFor(() => {
      expect(mockBump).toHaveBeenCalledWith(
        "AdminAddress",
        "Instance",
        100_000,
      );
    });
  });
});
