import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { GraphErrorBoundary } from "../GraphErrorBoundary";

function Boom(): never {
  throw new Error("kaboom");
}

function Ok() {
  return <div data-testid="ok-child">all good</div>;
}

/** A child that throws on first render but can be told to stop throwing. */
function Recoverable({ throwOnRender }: { throwOnRender: boolean }) {
  if (throwOnRender) throw new Error("kaboom");
  return <div data-testid="recovered-child">recovered</div>;
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("GraphErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <GraphErrorBoundary>
        <Ok />
      </GraphErrorBoundary>
    );
    expect(screen.getByTestId("ok-child")).toBeInTheDocument();
  });

  it("renders the fallback when a child throws", () => {
    render(
      <GraphErrorBoundary>
        <Boom />
      </GraphErrorBoundary>
    );
    expect(
      screen.getByText(/graph failed to load\. try refreshing the page\./i)
    ).toBeInTheDocument();
  });

  it("exposes the fallback with role=alert", () => {
    render(
      <GraphErrorBoundary>
        <Boom />
      </GraphErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders a retry button in the fallback", () => {
    render(
      <GraphErrorBoundary>
        <Boom />
      </GraphErrorBoundary>
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("resets error state and re-renders children when retry is clicked", () => {
    function Wrapper() {
      const [crash, setCrash] = useState(true);
      return (
        <div>
          <button onClick={() => setCrash(false)}>fix</button>
          <GraphErrorBoundary>
            <Recoverable throwOnRender={crash} />
          </GraphErrorBoundary>
        </div>
      );
    }

    render(<Wrapper />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Fix the underlying cause, then retry to clear the boundary.
    fireEvent.click(screen.getByText("fix"));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(screen.getByTestId("recovered-child")).toBeInTheDocument();
  });
});
