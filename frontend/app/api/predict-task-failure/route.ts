import { NextResponse } from 'next/server';

interface PredictionInput {
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
}

interface RiskFactor {
  id: string;
  severity: 'high' | 'moderate';
  title: string;
  description: string;
  recommendation: string;
  points: number;
}

const CONTRACT_ADDRESS_PATTERN = /^C[A-Z0-9]{55}$/;
const FUNCTION_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPredictionInput(value: unknown): value is PredictionInput {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.contractAddress === 'string' &&
    typeof value.functionName === 'string' &&
    typeof value.interval === 'number' &&
    Number.isFinite(value.interval) &&
    typeof value.gasBalance === 'number' &&
    Number.isFinite(value.gasBalance)
  );
}

function analyzeTask(input: PredictionInput) {
  const riskFactors: RiskFactor[] = [];

  if (!CONTRACT_ADDRESS_PATTERN.test(input.contractAddress)) {
    riskFactors.push({
      id: 'contract-address',
      severity: 'high',
      title: 'Contract address format is invalid',
      description: 'The target does not match the Stellar contract address format.',
      recommendation: 'Check the contract ID and enter its complete 56-character address.',
      points: 45,
    });
  }

  if (!FUNCTION_NAME_PATTERN.test(input.functionName)) {
    riskFactors.push({
      id: 'function-name',
      severity: 'high',
      title: 'Function name format is invalid',
      description: 'The function name does not match the supported contract function format.',
      recommendation: 'Check the contract ABI and use a lowercase function name with underscores or digits.',
      points: 45,
    });
  }

  if (input.gasBalance <= 0) {
    riskFactors.push({
      id: 'gas-balance-empty',
      severity: 'high',
      title: 'No gas balance is configured',
      description: 'A task without a positive gas balance cannot fund execution.',
      recommendation: 'Add a positive gas balance before registering this task.',
      points: 60,
    });
  } else if (input.gasBalance < 0.1) {
    riskFactors.push({
      id: 'gas-balance-low',
      severity: 'moderate',
      title: 'Gas balance is below the configured minimum',
      description: 'The task form requires at least 0.1 XLM for a gas balance.',
      recommendation: 'Increase the gas balance to at least 0.1 XLM, then review expected execution costs.',
      points: 30,
    });
  }

  if (input.interval < 60) {
    riskFactors.push({
      id: 'interval-too-short',
      severity: 'moderate',
      title: 'Execution interval is below the supported minimum',
      description: 'Intervals shorter than 60 seconds are rejected by the task form validation rules.',
      recommendation: 'Set the interval to at least 60 seconds.',
      points: 25,
    });
  }

  const riskScore = Math.min(
    100,
    riskFactors.reduce((total, factor) => total + factor.points, 0),
  );

  return {
    riskScore,
    confidence: 100,
    riskLevel: riskScore >= 50 ? 'high' : riskScore >= 25 ? 'moderate' : 'low',
    riskFactors,
    model: 'configuration-rules-v1',
    limitations: [
      'This is a configuration-rule estimate, not a trained machine-learning prediction or calibrated failure probability.',
      'No live contract simulation, target state, pool liquidity, or historical task failure data is available to this assessment.',
      'A low score does not guarantee successful execution.',
    ],
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (!isPredictionInput(body)) {
    return NextResponse.json(
      {
        error:
          'Provide contractAddress and functionName strings, plus finite numeric interval and gasBalance values.',
      },
      { status: 400 },
    );
  }

  return NextResponse.json(analyzeTask(body));
}
