import React from "react";
import { render, screen } from "@testing-library/react";
import {
  ZKProverProvider,
  useZKProverEngineContext,
} from "../ZKProverProvider";

describe("ZKProverProvider", () => {
  it("provides engine context to children", () => {
    function TestChild() {
      const ctx = useZKProverEngineContext();
      return (
        <div>
          <span>Status: {ctx.state.status}</span>
          <span>{ctx.isBusy ? "Proof generation active" : "Proof engine ready"}</span>
        </div>
      );
    }

    render(
      <ZKProverProvider>
        <TestChild />
      </ZKProverProvider>,
    );

    expect(screen.getByText("Status: idle")).toBeInTheDocument();
    expect(screen.getByText("Proof engine ready")).toBeInTheDocument();
  });

  it("throws error when used outside provider", () => {
    function TestChild() {
      useZKProverEngineContext();
      return null;
    }

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestChild />)).toThrow(
      "useZKProverEngineContext must be used within a ZKProverProvider",
    );
    consoleSpy.mockRestore();
  });
});
