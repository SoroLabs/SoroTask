export type OnboardingStepId =
  | "welcome"
  | "board"
  | "dashboard"
  | "keeper-metrics"
  | "wallet";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  body: string;
  targetSelector?: string;
  route?: string;
};

export type OnboardingState = {
  version: number;
  completed: boolean;
  skipped: boolean;
  currentStepIndex: number;
  lastUpdatedAt: string;
};

export const ONBOARDING_VERSION = 1;
export const STORAGE_KEY = "sorotask.onboarding.v1";
