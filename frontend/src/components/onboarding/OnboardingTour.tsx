"use client";

import { useEffect, useState } from "react";
import { ONBOARDING_STEPS } from "@/src/lib/onboarding/steps";
import { useOnboarding } from "./OnboardingProvider";

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function OnboardingTour() {
  const { state, skip, next, previous, complete } = useOnboarding();
  const step = ONBOARDING_STEPS[state.currentStepIndex];
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);

  useEffect(() => {
    if (!step?.targetSelector) {
      setSpotlight(null);
      return;
    }

    const update = () => {
      const el = document.querySelector(step.targetSelector!);
      if (!el) {
        setSpotlight(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      setSpotlight({
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  const isLast = state.currentStepIndex >= ONBOARDING_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none" aria-hidden={false}>
      <div className="absolute inset-0 bg-black/55 pointer-events-auto" onClick={skip} />

      {spotlight ? (
        <div
          className="absolute rounded-xl ring-2 ring-blue-400 ring-offset-2 ring-offset-neutral-950 pointer-events-none"
          style={{
            top: spotlight.top - 8,
            left: spotlight.left - 8,
            width: spotlight.width + 16,
            height: spotlight.height + 16,
          }}
        />
      ) : null}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="pointer-events-auto absolute left-1/2 bottom-6 w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl sm:bottom-10"
      >
        <p className="mb-1 text-xs uppercase tracking-wide text-blue-300">
          Step {state.currentStepIndex + 1} of {ONBOARDING_STEPS.length}
        </p>
        <h2 id="onboarding-title" className="text-lg font-semibold text-neutral-100">
          {step.title}
        </h2>
        <p className="mt-2 text-sm text-neutral-300">{step.body}</p>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={skip}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={state.currentStepIndex === 0}
              onClick={previous}
              className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm text-neutral-200 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={isLast ? complete : next}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
