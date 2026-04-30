import { fireEvent, render, screen } from "@testing-library/react";
import DashboardPage from "./page";

describe("DashboardPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders widgets with consistent state labels", () => {
    render(<DashboardPage />);

    expect(screen.getByText("Analytics Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("widget-volume")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("allows hiding a widget from the layout", () => {
    render(<DashboardPage />);

    const checkbox = screen.getByLabelText("Daily Volume");
    fireEvent.click(checkbox);

    expect(screen.queryByTestId("widget-volume")).not.toBeInTheDocument();
  });
});
