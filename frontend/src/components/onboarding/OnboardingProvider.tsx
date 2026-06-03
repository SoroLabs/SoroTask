"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ONBOARDING_STEPS } from "@/src/lib/onboarding/steps";
import {
  loadOnboardingState,
  resetOnboardingState,
  saveOnboardingState,
  shouldShowOnboarding,
} from "@/src/lib/onboarding/storage";
import type { OnboardingState } from "@/src/lib/onboarding/types";
import { OnboardingTour } from "./OnboardingTour";

type OnboardingContextValue = {
  state: OnboardingState;
  isActive: boolean;
  start: () => void;
  resume: () => void;
  skip: () => void;
  complete: () => void;
  goToStep: (index: number) => void;
  next: () => void;
  previous: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<OnboardingState>(loadOnboardingState);
  const [forcedActive, setForcedActive] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(loadOnboardingState());
    setReady(true);
  }, []);

  const persist = useCallback((next: OnboardingState) => {
    setState(next);
    saveOnboardingState(next);
  }, []);

  const isActive =
    ready && (forcedActive || shouldShowOnboarding(state));

  const navigateForStep = useCallback(
    (index: number) => {
      const step = ONBOARDING_STEPS[index];
      if (step?.route && pathname !== step.route) {
        router.push(step.route);
      }
    },
    [pathname, router],
  );

  const start = useCallback(() => {
    const next = { ...state, skipped: false, completed: false, currentStepIndex: 0 };
    persist(next);
    setForcedActive(true);
    navigateForStep(0);
  }, [navigateForStep, persist, state]);

  const resume = useCallback(() => {
    const next = {
      ...state,
      skipped: false,
      completed: false,
      currentStepIndex: Math.min(state.currentStepIndex, ONBOARDING_STEPS.length - 1),
    };
    persist(next);
    setForcedActive(true);
    navigateForStep(next.currentStepIndex);
  }, [navigateForStep, persist, state]);

  const skip = useCallback(() => {
    persist({ ...state, skipped: true, completed: false });
    setForcedActive(false);
  }, [persist, state]);

  const complete = useCallback(() => {
    persist({
      ...state,
      completed: true,
      skipped: false,
      currentStepIndex: ONBOARDING_STEPS.length - 1,
    });
    setForcedActive(false);
  }, [persist, state]);

  const goToStep = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, ONBOARDING_STEPS.length - 1));
      persist({ ...state, currentStepIndex: clamped });
      navigateForStep(clamped);
    },
    [navigateForStep, persist, state],
  );

  const next = useCallback(() => {
    if (state.currentStepIndex >= ONBOARDING_STEPS.length - 1) {
      complete();
      return;
    }
    goToStep(state.currentStepIndex + 1);
  }, [complete, goToStep, state.currentStepIndex]);

  const previous = useCallback(() => {
    goToStep(state.currentStepIndex - 1);
  }, [goToStep, state.currentStepIndex]);

  const value = useMemo(
    () => ({
      state,
      isActive,
      start,
      resume,
      skip,
      complete,
      goToStep,
      next,
      previous,
    }),
    [complete, goToStep, isActive, next, previous, resume, skip, start, state],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {isActive ? <OnboardingTour /> : null}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return ctx;
}

export function restartOnboardingFromSettings(): OnboardingState {
  return resetOnboardingState();
}
