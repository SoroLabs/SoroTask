import { render, screen, fireEvent } from "@testing-library/react";
import { ContractErrorBanner } from "../ContractErrorBanner";
import { mapContractError } from "../../lib/errors/contractErrors";
import { RAW_ERROR_FIXTURES } from "../../lib/errors/fixtures";

describe("ContractErrorBanner", () => {
  it("renders the title, message, and category code", () => {
    const error = mapContractError(RAW_ERROR_FIXTURES.WALLET_REJECTED);
    render(<ContractErrorBanner error={error} />);
    expect(screen.getByText(error.title)).toBeInTheDocument();
    expect(screen.getByText(error.userMessage)).toBeInTheDocument();
    expect(screen.getByText("WALLET_REJECTED")).toBeInTheDocument();
  });

  it("shows the retry button only when onRetry is provided and the action allows it", () => {
    const retryable = mapContractError(RAW_ERROR_FIXTURES.WALLET_REJECTED);
    const waiting = mapContractError(RAW_ERROR_FIXTURES.NETWORK_ERROR);

    const { rerender } = render(<ContractErrorBanner error={retryable} />);
    expect(screen.queryByTestId("contract-error-retry")).toBeNull();

    rerender(
      <ContractErrorBanner error={retryable} onRetry={() => undefined} />,
    );
    expect(screen.getByTestId("contract-error-retry")).toBeInTheDocument();

    rerender(
      <ContractErrorBanner error={waiting} onRetry={() => undefined} />,
    );
    // Network errors auto-retry — retry button is suppressed even when
    // a handler is supplied.
    expect(screen.queryByTestId("contract-error-retry")).toBeNull();
    expect(screen.getByTestId("contract-error-wait")).toBeInTheDocument();
  });

  it("calls onRetry and onDismiss when their buttons are clicked", () => {
    const onRetry = jest.fn();
    const onDismiss = jest.fn();
    const error = mapContractError(RAW_ERROR_FIXTURES.INVALID_ARGS);
    render(
      <ContractErrorBanner
        error={error}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId("contract-error-retry"));
    fireEvent.click(screen.getByTestId("contract-error-dismiss"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("toggles the technical details panel and includes the raw message", () => {
    const error = mapContractError(RAW_ERROR_FIXTURES.BAD_SEQUENCE);
    render(<ContractErrorBanner error={error} />);
    expect(screen.queryByTestId("contract-error-debug")).toBeNull();
    fireEvent.click(screen.getByTestId("contract-error-debug-toggle"));
    const panel = screen.getByTestId("contract-error-debug");
    expect(panel.textContent).toContain("category: BAD_SEQUENCE");
    expect(panel.textContent).toContain("code: TX_BAD_SEQ");
    expect(panel.textContent).toContain("message: tx_bad_seq");
  });

  it("respects actionOverride to force a wait UI on a normally-retryable error", () => {
    const error = mapContractError(RAW_ERROR_FIXTURES.WALLET_REJECTED);
    render(
      <ContractErrorBanner
        error={error}
        actionOverride="wait"
        onRetry={() => undefined}
      />,
    );
    // The override demotes the retry button and shows the wait indicator.
    expect(screen.queryByTestId("contract-error-retry")).toBeNull();
    expect(screen.getByTestId("contract-error-wait")).toBeInTheDocument();
    expect(
      screen.getByTestId("contract-error-banner"),
    ).toHaveAttribute("data-action", "wait");
  });
});
