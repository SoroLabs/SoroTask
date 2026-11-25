'use client';

import React, { useState, useCallback, useId } from 'react';

type StepValidation<T> = (data: T) => string | null;

export interface WizardStep<T> {
  id: string;
  label: string;
  description?: string;
  render: (data: T, onChange: (patch: Partial<T>) => void) => React.ReactNode;
  validate?: StepValidation<T>;
}

export interface WizardProps<T> {
  steps: WizardStep<T>[];
  initialData: T;
  onSubmit: (data: T) => void | Promise<void>;
  submittingLabel?: string;
}

export function Wizard<T extends Record<string, unknown>>({
  steps,
  initialData,
  onSubmit,
  submittingLabel = 'Submit',
}: WizardProps<T>) {
  const [current, setCurrent] = useState(0);
  const [data, setData] = useState<T>(initialData);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();

  const apply = useCallback(
    (patch: Partial<T>) =>
      setData((prev) => ({ ...prev, ...patch } as T)),
    []
  );

  const step = steps[current];
  const isLast = current === steps.length - 1;
  const isFirst = current === 0;

  async function handleNext() {
    if (!step.validate) {
      setCurrent((c) => Math.min(c + 1, steps.length - 1));
      return;
    }
    const message = step.validate(data);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setCurrent((c) => Math.min(c + 1, steps.length - 1));
  }

  async function handleBack() {
    setError(null);
    setCurrent((c) => Math.max(c - 1, 0));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="wizard rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-xl"
      data-testid="wizard"
    >
      <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
        {steps.map((s, idx) => {
          const active = idx === current;
          const done = idx < current;
          return (
            <li key={s.id} className="flex items-center gap-2">
              <span
                aria-current={active ? 'step' : undefined}
                className={[
                  'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold border',
                  done
                    ? 'border-green-500 bg-green-500/20 text-green-300'
                    : active
                      ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                      : 'border-neutral-700 bg-neutral-800 text-neutral-400',
                ].join(' ')}
              >
                {done ? '✓' : idx + 1}
              </span>
              <span
                className={[
                  'hidden text-xs sm:inline',
                  active ? 'text-white' : done ? 'text-neutral-400' : 'text-neutral-600',
                ].join(' ')}
                aria-hidden="true"
              >
                {s.label}
              </span>
              {idx < steps.length - 1 && (
                <span className="mx-1 h-px w-4 bg-neutral-700" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">{step.label}</h2>
        {step.description && (
          <p className="mt-1 text-sm text-neutral-400">{step.description}</p>
        )}
      </div>

      <div className="mb-8">
        {step.render(data, apply)}
        {error && (
          <p className="mt-3 text-sm text-red-400" role="alert" id={`${uid}-error`}>
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          disabled={isFirst}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
        >
          Back
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : submittingLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
