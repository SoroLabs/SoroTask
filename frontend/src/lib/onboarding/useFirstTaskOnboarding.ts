"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  firstTaskFlowReducer,
  initFirstTaskFlow,
  isStepRunnable,
  type FirstTaskFlowState,
  type FirstTaskStepId,
} from "./firstTaskFlow";

export type StepRunner = (stepId: FirstTaskStepId) => Promise<void>;

export interface UseFirstTaskOnboarding {
  state: FirstTaskFlowState;
  retry: () => void;
  skip: () => void;
  reset: () => void;
}

// Drives the first-task onboarding: runs each step's injected async action in
// order, advancing on success and surfacing failures for a manual retry.
export function useFirstTaskOnboarding(runStep: StepRunner): UseFirstTaskOnboarding {
  const [state, dispatch] = useReducer(firstTaskFlowReducer, undefined, initFirstTaskFlow);

  const runnerRef = useRef(runStep);
  runnerRef.current = runStep;
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isStepRunnable(state) || inFlight.current) return;

    const stepId = state.steps[state.currentIndex].id;
    inFlight.current = true;
    dispatch({ type: "start" });

    runnerRef
      .current(stepId)
      .then(() => dispatch({ type: "success" }))
      .catch((err: unknown) =>
        dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      )
      .finally(() => {
        inFlight.current = false;
      });
  }, [state]);

  const retry = useCallback(() => dispatch({ type: "retry" }), []);
  const skip = useCallback(() => dispatch({ type: "skip" }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return { state, retry, skip, reset };
}
