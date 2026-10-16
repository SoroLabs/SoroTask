import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VoiceAssistant, parseNaturalLanguageTask } from "../VoiceAssistant";

describe("VoiceAssistant & NLP Intent Parser", () => {
  it("extracts task parameters accurately from natural commands", () => {
    const transcript =
      "Swap 50 USDC to XLM every Monday at 9am with 20 XLM gas deposit";
    const intent = parseNaturalLanguageTask(transcript);

    expect(intent.confidence).toBeGreaterThanOrEqual(0.8);
    expect(intent.extractedParams.functionName).toBe("swap_tokens");
    expect(intent.extractedParams.cronInterval).toBe("0 9 * * 1");
    expect(intent.extractedParams.gasDeposit).toBe("20");
    expect(intent.extractedParams.functionArgs).toContain("USDC");
  });

  it("extracts target contract addresses when provided in transcript", () => {
    const contract = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const transcript = `Execute task on ${contract} every hour`;
    const intent = parseNaturalLanguageTask(transcript);

    expect(intent.extractedParams.targetContractId).toBe(contract);
    expect(intent.extractedParams.cronInterval).toBe("0 * * * *");
  });

  it("renders assistant UI and populates review card on input", () => {
    const mockApply = jest.fn();
    render(<VoiceAssistant onApplyIntent={mockApply} />);

    expect(
      screen.getByText("Voice & Natural Language Task Creator"),
    ).toBeInTheDocument();

    const input = screen.getByTestId("natural-command-input");
    fireEvent.change(input, {
      target: { value: "Rebalance pool position daily with 10 deposit" },
    });

    expect(screen.getByTestId("intent-review-card")).toBeInTheDocument();
    expect(screen.getByText("rebalance_pool()")).toBeInTheDocument();

    // Click Apply button
    const applyBtn = screen.getByTestId("apply-intent-btn");
    fireEvent.click(applyBtn);

    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "rebalance_pool",
        gasDeposit: "10",
      }),
    );
  });
});
