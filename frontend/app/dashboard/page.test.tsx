import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardClient } from "./DashboardClient";
import { FALLBACK_WIDGETS } from "@/src/lib/rsc/server-data";

const mockData = {
  widgets: FALLBACK_WIDGETS,
  lastUpdated: new Date().toISOString(),
};

describe("DashboardClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders widgets with consistent state labels", async () => {
    render(<DashboardClient initialData={mockData} />);

    await waitFor(() => {
      expect(screen.getByTestId("widget-volume")).toBeInTheDocument();
    });

    expect(screen.getAllByText("success").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("allows hiding a widget from the layout", async () => {
    render(<DashboardClient initialData={mockData} />);

    await waitFor(() => {
      expect(screen.getByTestId("widget-volume")).toBeInTheDocument();
    });

    const checkbox = screen.getByLabelText("Daily Volume");
    fireEvent.click(checkbox);

    expect(screen.queryByTestId("widget-volume")).not.toBeInTheDocument();
  });
});
