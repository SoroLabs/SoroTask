import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";
import * as Sentry from "@sentry/nextjs";

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

const ProblemComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error("Widget chart rendering failure");
  }
  return <div>Widget Content Operating Normally</div>;
};

describe("ErrorBoundary Granular Isolation & Sentry Context", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Prevent console.error from cluttering test output
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  it("renders children normally when no error occurs", () => {
    render(
      <ErrorBoundary section="test-widget">
        <ProblemComponent shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(
      screen.getByText("Widget Content Operating Normally"),
    ).toBeInTheDocument();
  });

  it("isolates widget crash and renders error fallback card", () => {
    render(
      <div>
        <ErrorBoundary section="failing-widget">
          <ProblemComponent shouldThrow={true} />
        </ErrorBoundary>
        <div data-testid="healthy-widget">Healthy Neighbor Widget</div>
      </div>,
    );

    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();
    expect(
      screen.getByText("Widget chart rendering failure"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("healthy-widget")).toBeInTheDocument();
  });

  it("captures exception in Sentry with enriched diagnostic context", () => {
    render(
      <ErrorBoundary
        section="chart-widget"
        walletProvider="Freighter"
        networkId="Futurenet"
        contractAddress="CAFE1234567890ABCDEF1234567890ABCDEF1234"
      >
        <ProblemComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          section: "chart-widget",
          walletProvider: "Freighter",
          networkId: "Futurenet",
          contractAddress: "CAFE1234567890ABCDEF1234567890ABCDEF1234",
        }),
      }),
    );
  });

  it("resets error state when Retry widget button is clicked", () => {
    const onRetryMock = jest.fn();
    const throwError = true;

    const TestContainer = () => {
      const [shouldThrow, setShouldThrow] = React.useState(true);
      return (
        <ErrorBoundary
          section="retry-widget"
          onRetry={() => {
            onRetryMock();
            setShouldThrow(false);
          }}
        >
          <ProblemComponent shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    };

    render(<TestContainer />);

    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();

    const retryButton = screen.getByText("Retry widget");
    fireEvent.click(retryButton);

    expect(onRetryMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Widget Content Operating Normally"),
    ).toBeInTheDocument();
  });
});
