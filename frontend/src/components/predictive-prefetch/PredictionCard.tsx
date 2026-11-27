'use client';

import { useEffect, useState } from 'react';

export interface PredictionInput {
  contractAddress: string;
  functionName: string;
  interval: string;
  gasBalance: string;
}

interface RiskFactor {
  id: string;
  severity: 'high' | 'moderate';
  title: string;
  description: string;
  recommendation: string;
}

interface Prediction {
  riskScore: number;
  confidence: number;
  riskLevel: 'low' | 'moderate' | 'high';
  riskFactors: RiskFactor[];
  limitations: string[];
}

type PredictionState =
  | { status: 'incomplete' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; prediction: Prediction };

function isPrediction(value: unknown): value is Prediction {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.riskScore === 'number' &&
    typeof candidate.confidence === 'number' &&
    (candidate.riskLevel === 'low' ||
      candidate.riskLevel === 'moderate' ||
      candidate.riskLevel === 'high') &&
    Array.isArray(candidate.riskFactors) &&
    Array.isArray(candidate.limitations)
  );
}

export function PredictionCard({ input }: { input: PredictionInput }) {
  const [state, setState] = useState<PredictionState>({ status: 'incomplete' });
  const complete =
    input.contractAddress.trim() !== '' &&
    input.functionName.trim() !== '' &&
    input.interval.trim() !== '' &&
    input.gasBalance.trim() !== '';

  useEffect(() => {
    if (!complete) {
      setState({ status: 'incomplete' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState({ status: 'loading' });
      try {
        const response = await fetch('/api/predict-task-failure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contractAddress: input.contractAddress.trim(),
            functionName: input.functionName.trim(),
            interval: Number(input.interval),
            gasBalance: Number(input.gasBalance),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody: unknown = await response.json().catch(() => null);
          const message =
            typeof errorBody === 'object' &&
            errorBody !== null &&
            'error' in errorBody &&
            typeof errorBody.error === 'string'
              ? errorBody.error
              : 'Unable to analyze this task right now.';
          throw new Error(message);
        }

        const prediction: unknown = await response.json();
        if (!isPrediction(prediction)) {
          throw new Error('The diagnostic service returned an invalid response.');
        }
        setState({ status: 'ready', prediction });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to analyze this task right now.',
        });
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [complete, input.contractAddress, input.functionName, input.gasBalance, input.interval]);

  return (
    <section
      className="rounded-lg border border-neutral-700 bg-neutral-900/70 p-4"
      aria-labelledby="prediction-heading"
      aria-busy={state.status === 'loading'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="prediction-heading" className="font-semibold text-neutral-100">
            Pre-execution diagnostics
          </h3>
          <p className="mt-1 text-xs text-neutral-400">
            Rule-based configuration checks; not an ML model or transaction simulation.
          </p>
        </div>
        {state.status === 'ready' && (
          <span className="rounded-full border border-neutral-600 px-2.5 py-1 text-xs text-neutral-300">
            {state.prediction.confidence}% input coverage
          </span>
        )}
      </div>

      {state.status === 'incomplete' && (
        <p className="mt-3 text-sm text-neutral-400">
          Enter the contract, function, interval, and gas balance to check this task before registration.
        </p>
      )}
      {state.status === 'loading' && (
        <p className="mt-3 text-sm text-neutral-300" role="status" aria-live="polite">
          Checking task configuration…
        </p>
      )}
      {state.status === 'error' && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          Diagnostics unavailable: {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <label htmlFor="task-risk-score" className="text-sm text-neutral-300">
              Configuration risk score
            </label>
            <progress
              id="task-risk-score"
              className="h-2 flex-1 accent-amber-400"
              max={100}
              value={state.prediction.riskScore}
              aria-label={`Configuration risk score: ${state.prediction.riskScore} out of 100`}
            />
            <span className="min-w-12 text-right text-sm font-semibold tabular-nums text-neutral-100">
              {state.prediction.riskScore}/100
            </span>
          </div>

          <p
            className={`text-sm font-medium ${
              state.prediction.riskLevel === 'high'
                ? 'text-red-300'
                : state.prediction.riskLevel === 'moderate'
                  ? 'text-amber-300'
                  : 'text-emerald-300'
            }`}
            role={state.prediction.riskLevel === 'high' ? 'alert' : 'status'}
            aria-live={state.prediction.riskLevel === 'high' ? 'assertive' : 'polite'}
          >
            {state.prediction.riskLevel === 'high'
              ? 'High configuration risk — review the recommendations before registering.'
              : state.prediction.riskLevel === 'moderate'
                ? 'Potential configuration issues found — review the recommendations.'
                : 'No configuration issues found by the available checks.'}
          </p>

          {state.prediction.riskFactors.length > 0 ? (
            <ul className="space-y-3">
              {state.prediction.riskFactors.map((factor) => (
                <li
                  key={factor.id}
                  className="rounded-md border border-neutral-700 bg-neutral-800/70 p-3"
                >
                  <p className="text-sm font-medium text-neutral-100">
                    {factor.title}
                    <span className="ml-2 text-xs uppercase text-neutral-400">{factor.severity}</span>
                  </p>
                  <p className="mt-1 text-sm text-neutral-300">{factor.description}</p>
                  <p className="mt-1 text-sm text-teal-200">Recommendation: {factor.recommendation}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-300">No configured risk factors were detected.</p>
          )}

          <details className="text-xs text-neutral-400">
            <summary className="cursor-pointer">Assessment coverage and limitations</summary>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {state.prediction.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
