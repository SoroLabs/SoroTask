import { NextResponse } from "next/server";

type RequestBody = {
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
};

type PredictionResponse = {
  riskScore: number;
  riskLevel: "low" | "moderate" | "high" | "critical";
  confidence: "low" | "medium" | "high";
  summary: string;
  evidence: {
    gasShortfall: boolean;
    intervalTooFast: boolean;
    contractReputation: string;
  };
};

function validateRequestBody(body: any): RequestBody {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const contractAddress = String(body.contractAddress || "").trim();
  const functionName = String(body.functionName || "").trim();
  const interval = Number(body.interval);
  const gasBalance = Number(body.gasBalance);

  if (!contractAddress || !functionName) {
    throw new Error("contractAddress and functionName are required.");
  }

  if (!Number.isFinite(interval) || interval < 1) {
    throw new Error("interval must be a positive number.");
  }

  if (!Number.isFinite(gasBalance) || gasBalance < 0) {
    throw new Error("gasBalance must be a non-negative number.");
  }

  return { contractAddress, functionName, interval, gasBalance };
}

function localPrediction(input: RequestBody): PredictionResponse {
  const gasShortfall = input.gasBalance < 8;
  const intervalTooFast = input.interval < 300;
  const contractRisk = /claim|transfer|withdraw|rebalance|reward/i.test(input.functionName);

  const gasPenalty = Math.min(40, Math.max(0, 24 - input.gasBalance * 2));
  const intervalPenalty = intervalTooFast ? 34 : input.interval < 1800 ? 12 : 0;
  const functionPenalty = contractRisk ? 18 : 0;

  const score = Math.min(100, gasPenalty + intervalPenalty + functionPenalty + 10);
  const riskLevel =
    score >= 80 ? "critical" : score >= 60 ? "high" : score >= 30 ? "moderate" : "low";
  const confidence =
    input.gasBalance >= 10 && input.interval >= 3600 ? "high" : input.gasBalance >= 5 ? "medium" : "low";

  const summary =
    riskLevel === "critical"
      ? "Highly likely to fail unless the configuration is updated."
      : riskLevel === "high"
      ? "There is a significant chance of failure. Review the task before registering."
      : riskLevel === "moderate"
      ? "Minor risk indicators detected. Use caution when registering."
      : "This task appears to have low failure risk based on the configured values.";

  return {
    riskScore: score,
    riskLevel,
    confidence,
    summary,
    evidence: {
      gasShortfall,
      intervalTooFast,
      contractReputation: input.contractAddress.startsWith("C")
        ? "Matches a Stellar-style contract address pattern."
        : "Contract address is unusual or could require additional validation.",
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = validateRequestBody(body);

    const externalUrl = process.env.PREDICTIVE_FAILURE_API_URL;
    if (externalUrl) {
      try {
        const externalResponse = await fetch(externalUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-soro-task-client": "frontend-predictive-ui",
          },
          body: JSON.stringify(parsed),
        });

        if (externalResponse.ok) {
          const externalData = await externalResponse.json();
          return NextResponse.json(externalData);
        }

        console.error("External prediction API returned non-ok status", externalResponse.status);
      } catch (externalError) {
        console.error("External prediction API failed:", externalError);
      }
    }

    return NextResponse.json(localPrediction(parsed));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to parse request." },
      { status: 400 }
    );
  }
}
