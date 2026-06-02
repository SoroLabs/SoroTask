import {
  ONBOARDING_VERSION,
  STORAGE_KEY,
  type OnboardingState,
} from "./types";

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  version: ONBOARDING_VERSION,
  completed: false,
  skipped: false,
  currentStepIndex: 0,
  lastUpdatedAt: new Date(0).toISOString(),
};

export function loadOnboardingState(): OnboardingState {
  if (typeof window === "undefined") {
    return DEFAULT_ONBOARDING_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ONBOARDING_STATE;
    const parsed = JSON.parse(raw) as OnboardingState;
    if (parsed.version !== ONBOARDING_VERSION) {
      return DEFAULT_ONBOARDING_STATE;
    }
    return { ...DEFAULT_ONBOARDING_STATE, ...parsed };
  } catch {
    return DEFAULT_ONBOARDING_STATE;
  }
}

export function saveOnboardingState(state: OnboardingState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...state,
      lastUpdatedAt: new Date().toISOString(),
    }),
  );
}

export function shouldShowOnboarding(state: OnboardingState): boolean {
  return !state.completed && !state.skipped;
}

export function resetOnboardingState(): OnboardingState {
  const next = { ...DEFAULT_ONBOARDING_STATE, lastUpdatedAt: new Date().toISOString() };
  saveOnboardingState(next);
  return next;
}
