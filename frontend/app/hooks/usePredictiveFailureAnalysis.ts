export type FailureRiskLevel = "low" | "moderate" | "high" | "critical";
import { useEffect, useState } from "react";

export type FailureConfidence = "low" | "medium" | "high";

export interface PredictiveFailureInput {
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
}

export interface PredictiveFailurePrediction {
  riskScore: number;
  riskLevel: FailureRiskLevel;
  confidence: FailureConfidence;
  summary: string;
  evidence: {
    gasShortfall: boolean;
    intervalTooFast: boolean;
    contractReputation: string;
  };
}

export type FailureAnalysisStatus = "idle" | "pending" | "success" | "error";

export interface FailureAnalysisResult {
  status: FailureAnalysisStatus;
  prediction: PredictiveFailurePrediction | null;
  error?: string;
}

function isInputReady(input: PredictiveFailureInput): boolean {
  return (
    input.contractAddress.trim().length > 0 &&
    input.functionName.trim().length > 0 &&
    Number.isFinite(input.interval) &&
    input.interval >= 1 &&
    Number.isFinite(input.gasBalance) &&
    input.gasBalance >= 0
  );
}

function normalizeInput(input: PredictiveFailureInput): PredictiveFailureInput {
  return {
    contractAddress: input.contractAddress.trim(),
    functionName: input.functionName.trim(),
    interval: Math.max(0, Number.isFinite(input.interval) ? input.interval : 0),
    gasBalance: Math.max(0, Number.isFinite(input.gasBalance) ? input.gasBalance : 0),
  };
}

function buildLocalPrediction(input: PredictiveFailureInput): PredictiveFailurePrediction {
  const gasShortfall = input.gasBalance < 8;
  const intervalTooFast = input.interval < 300;
  const contractRisk = /claim|transfer|withdraw|rewards?/i.test(input.functionName);

  const gasScore = Math.min(40, Math.max(0, 22 - input.gasBalance * 2));
  const intervalScore = intervalTooFast ? 35 : input.interval < 1800 ? 14 : 0;
  const contractScore = contractRisk ? 18 : 0;
  const baseScore = Math.min(100, gasScore + intervalScore + contractScore + 10);

  const riskLevel: FailureRiskLevel =
    baseScore >= 80
      ? "critical"
      : baseScore >= 60
      ? "high"
      : baseScore >= 30
      ? "moderate"
      : "low";

  const confidence: FailureConfidence =
    input.gasBalance >= 10 && input.interval >= 3600 ? "high" : input.gasBalance >= 5 ? "medium" : "low";

  const summary =
    riskLevel === "critical"
      ? "This task configuration is likely to fail unless the job is adjusted."
      : riskLevel === "high"
      ? "The task has a high chance of failure and should be reviewed before registration."
      : riskLevel === "moderate"
      ? "There are some warning signals. Validate the task details before you submit."
      : "This task appears low risk based on the current configuration.";

  return {
    riskScore: baseScore,
    riskLevel,
    confidence,
    summary,
    evidence: {
      gasShortfall,
      intervalTooFast,
      contractReputation: input.contractAddress.startsWith("C")
        ? "Contract has a recognized Stellar-style prefix."
        : "Contract profile is unknown or unconventional.",
    },
  };
}

export default function usePredictiveFailureAnalysis(
  input: PredictiveFailureInput
): FailureAnalysisResult {
  const [status, setStatus] = useState<FailureAnalysisStatus>("idle");
  const [prediction, setPrediction] = useState<PredictiveFailurePrediction | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const normalizedInput = normalizeInput(input);

  useEffect(() => {
    if (!isInputReady(normalizedInput)) {
      setStatus("idle");
      setPrediction(null);
      setError(undefined);
      return;
    }

    let isActive = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setStatus("pending");
      setError(undefined);

      if (typeof fetch !== "function") {
        setStatus("error");
        setError("Fetch API unavailable. Risk analysis cannot run.");
        return;
      }

      try {
        const response = await fetch("/api/predict-task-failure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(normalizedInput),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Prediction service returned ${response.status}`);
        }

        const payload = await response.json();

        if (!isActive) {
          return;
        }

        if (payload?.error) {
          throw new Error(payload.error);
        }

        setPrediction(payload as PredictiveFailurePrediction);
        setStatus("success");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        if (!isActive) return;

        console.error("Predictive failure analysis error:", err);
        setStatus("error");
        setError("Unable to analyze task risk right now. Please try again later.");
      }
    }, 450);

    return () => {
      isActive = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [normalizedInput.contractAddress, normalizedInput.functionName, normalizedInput.interval, normalizedInput.gasBalance]);

  return { status, prediction, error };
}
