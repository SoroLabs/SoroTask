import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import { VoiceAssistant, parseNaturalLanguageTask } from "../VoiceAssistant";

expect.extend(toHaveNoViolations);

describe("VoiceAssistant & NLP Intent Parser", () => {
  afterEach(() => {
    jest.useRealTimers();
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>)
      .webkitSpeechRecognition;
  });

  describe("parseNaturalLanguageTask", () => {
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
      const contract =
        "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
      const transcript = `Execute task on ${contract} every hour`;
      const intent = parseNaturalLanguageTask(transcript);

      expect(intent.extractedParams.targetContractId).toBe(contract);
      expect(intent.extractedParams.cronInterval).toBe("0 * * * *");
      expect(intent.confidence).toBe(0.95);
    });

    it("extracts explicit method names, custom intervals, and transfer/claim actions", () => {
      const contract =
        "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
      const explicitIntent = parseNaturalLanguageTask(
        `Call distribute_yield on ${contract} every 15 minutes with 30 XLM gas`,
      );
      expect(explicitIntent.extractedParams.functionName).toBe(
        "distribute_yield",
      );
      expect(explicitIntent.extractedParams.cronInterval).toBe("*/15 * * * *");
      expect(explicitIntent.extractedParams.gasDeposit).toBe("30");

      const claimIntent = parseNaturalLanguageTask(
        `Claim rewards on ${contract} every Friday at 5pm`,
      );
      expect(claimIntent.extractedParams.functionName).toBe("claim_rewards");
      expect(claimIntent.extractedParams.cronInterval).toBe("0 17 * * 5");

      const transferIntent = parseNaturalLanguageTask(
        `Transfer 25 XLM on ${contract} every 4 hours`,
      );
      expect(transferIntent.extractedParams.functionName).toBe("transfer");
      expect(transferIntent.extractedParams.cronInterval).toBe("0 */4 * * *");
    });
  });

  describe("VoiceAssistant UI & Confirmation Modal", () => {
    it("renders assistant UI, opens confirmation modal, and applies parameters only after confirmation", () => {
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

      // Clicking Review & Apply opens confirmation modal without applying yet
      const applyBtn = screen.getByTestId("apply-intent-btn");
      fireEvent.click(applyBtn);

      expect(
        screen.getByTestId("voice-confirmation-modal"),
      ).toBeInTheDocument();
      expect(mockApply).not.toHaveBeenCalled();

      // Cancel closes modal without applying
      fireEvent.click(screen.getByTestId("cancel-confirm-btn"));
      expect(
        screen.queryByTestId("voice-confirmation-modal"),
      ).not.toBeInTheDocument();
      expect(mockApply).not.toHaveBeenCalled();

      // Re-open and confirm
      fireEvent.click(applyBtn);
      fireEvent.click(screen.getByTestId("confirm-apply-intent-btn"));

      expect(mockApply).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "rebalance_pool",
          cronInterval: "0 0 * * *",
          gasDeposit: "10",
        }),
      );
      expect(screen.getByTestId("intent-confirmed-msg")).toBeInTheDocument();
    });

    it("closes confirmation modal on Escape key", () => {
      render(<VoiceAssistant onApplyIntent={jest.fn()} />);
      const input = screen.getByTestId("natural-command-input");
      fireEvent.change(input, {
        target: { value: "Swap 50 USDC every hour" },
      });

      fireEvent.click(screen.getByTestId("apply-intent-btn"));
      expect(
        screen.getByTestId("voice-confirmation-modal"),
      ).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(
        screen.queryByTestId("voice-confirmation-modal"),
      ).not.toBeInTheDocument();
    });

    it("handles Web Speech API final transcription and error states", () => {
      let mockInstance: {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((e: unknown) => void) | null;
        onerror: ((e: unknown) => void) | null;
        onend: (() => void) | null;
        start: jest.Mock;
        stop: jest.Mock;
        abort: jest.Mock;
      } | null = null;

      class MockSpeechRecognition {
        continuous = false;
        interimResults = false;
        lang = "";
        onresult = null;
        onerror = null;
        onend = null;
        start = jest.fn();
        stop = jest.fn();
        abort = jest.fn();
        constructor() {
          mockInstance = this;
        }
      }

      (
        window as unknown as {
          SpeechRecognition: typeof MockSpeechRecognition;
        }
      ).SpeechRecognition = MockSpeechRecognition;

      render(<VoiceAssistant onApplyIntent={jest.fn()} />);

      const toggleBtn = screen.getByTestId("voice-toggle-btn");
      fireEvent.click(toggleBtn);
      expect(mockInstance?.start).toHaveBeenCalledTimes(1);
      expect(toggleBtn).toHaveAttribute("aria-pressed", "true");

      // Simulate speech recognition final result
      act(() => {
        mockInstance?.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: {
              isFinal: true,
              length: 1,
              0: {
                transcript:
                  "Swap 100 USDC every Monday at 9am with 25 XLM gas deposit",
                confidence: 0.96,
              },
            },
          },
        });
        mockInstance?.onend?.();
      });

      expect(screen.getByTestId("intent-review-card")).toBeInTheDocument();
      expect(screen.getByText("swap_tokens()")).toBeInTheDocument();

      // Simulate permission denied error
      act(() => {
        mockInstance?.onerror?.({ error: "not-allowed" });
      });

      expect(screen.getByTestId("voice-error-alert")).toHaveTextContent(
        /Microphone access was denied/i,
      );
    });

    it("supports hands-free Alt+V keyboard shortcut and fallback demo mode", () => {
      jest.useFakeTimers();
      render(<VoiceAssistant onApplyIntent={jest.fn()} />);

      expect(
        screen.getByTestId("voice-unsupported-notice"),
      ).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "v", altKey: true });
      expect(screen.getByTestId("voice-toggle-btn")).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      act(() => {
        jest.advanceTimersByTime(850);
      });

      expect(screen.getByTestId("intent-review-card")).toBeInTheDocument();
      expect(screen.getByText("swap_tokens()")).toBeInTheDocument();
    });

    it("has no accessibility violations (default and confirmation modal open)", async () => {
      const { container } = render(
        <VoiceAssistant onApplyIntent={jest.fn()} />,
      );
      expect(await axe(container)).toHaveNoViolations();

      fireEvent.change(screen.getByTestId("natural-command-input"), {
        target: { value: "Swap 50 USDC every Monday at 9am" },
      });
      fireEvent.click(screen.getByTestId("apply-intent-btn"));

      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
