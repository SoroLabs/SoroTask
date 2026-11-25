import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AnalyticsSandboxPage from "../page";

describe("AnalyticsSandboxPage", () => {
  it("renders the sandbox form and empty state", () => {
    render(<AnalyticsSandboxPage />);

    expect(screen.getByRole("heading", { name: "Execution Sandbox" })).toBeInTheDocument();
    expect(screen.getByLabelText("Target Contract")).toHaveValue("C4F6B8D2A9E1");
    expect(screen.getByText(/Run a simulation to generate projected costs/i)).toBeInTheDocument();
  });

  it("runs a simulation and displays projected state changes", async () => {
    render(<AnalyticsSandboxPage />);

    fireEvent.click(screen.getByRole("button", { name: "Run Simulation" }));

    await waitFor(() => {
      expect(screen.getByText("Total Cost")).toBeInTheDocument();
    });
    expect(screen.getByText("tasks.task-42.gas_balance_xlm")).toBeInTheDocument();
    expect(screen.getByText(/success/i)).toBeInTheDocument();
  });

  it("shows parse errors for invalid argument JSON", async () => {
    render(<AnalyticsSandboxPage />);

    fireEvent.change(screen.getByLabelText("Arguments JSON"), {
      target: { value: "{\"not\":\"array\"}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Simulation" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Arguments JSON must be an array.");
    });
  });

  it("renders tracked validation errors for blocked simulations", async () => {
    render(<AnalyticsSandboxPage />);

    fireEvent.change(screen.getByLabelText("Gas Balance (XLM)"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Simulation" }));

    await waitFor(() => {
      expect(screen.getByText("Error Tracking")).toBeInTheDocument();
    });
    expect(screen.getByText("Gas balance must be greater than 0 XLM.")).toBeInTheDocument();
  });

  it("renders warning projections from risky inputs", async () => {
    render(<AnalyticsSandboxPage />);

    fireEvent.change(screen.getByLabelText("Target Contract"), {
      target: { value: "C4F6B8D2A9E1AA" },
    });
    fireEvent.change(screen.getByLabelText("Interval (sec)"), {
      target: { value: "120" },
    });
    fireEvent.change(screen.getByLabelText("Keeper Failure Rate (%)"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Simulation" }));

    await waitFor(() => {
      expect(screen.getByText("Fallbacks and Warnings")).toBeInTheDocument();
    });
    expect(screen.getByText("warning - local-fallback")).toBeInTheDocument();
    expect(
      screen.getByText("Keeper failure rate is high enough to affect execution reliability."),
    ).toBeInTheDocument();
  });

  it("accepts edits across the full simulation form", async () => {
    render(<AnalyticsSandboxPage />);

    fireEvent.change(screen.getByLabelText("Task ID"), { target: { value: "task-99" } });
    fireEvent.change(screen.getByLabelText("Function"), { target: { value: "rebalance" } });
    fireEvent.change(screen.getByLabelText("Fork Ledger"), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText("Keepers"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Fork RPC URL"), {
      target: { value: "http://localhost:8000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Simulation" }));

    await waitFor(() => {
      expect(screen.getByText("tasks.task-99.gas_balance_xlm")).toBeInTheDocument();
    });
    expect(screen.getByText("contracts.C4F6B8D2A9E1.rebalance.args_hash")).toBeInTheDocument();
  });
});
