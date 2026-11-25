import {
  DEFAULT_ONBOARDING_STATE,
  loadOnboardingState,
  resetOnboardingState,
  saveOnboardingState,
  shouldShowOnboarding,
} from "../storage";
import { STORAGE_KEY } from "../types";

describe("onboarding storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns default state when storage is empty", () => {
    expect(loadOnboardingState()).toEqual(DEFAULT_ONBOARDING_STATE);
    expect(shouldShowOnboarding(DEFAULT_ONBOARDING_STATE)).toBe(true);
  });

  it("persists skip and completed flags", () => {
    saveOnboardingState({
      ...DEFAULT_ONBOARDING_STATE,
      skipped: true,
      currentStepIndex: 2,
    });
    const loaded = loadOnboardingState();
    expect(loaded.skipped).toBe(true);
    expect(shouldShowOnboarding(loaded)).toBe(false);
  });

  it("resets onboarding for settings restart", () => {
    saveOnboardingState({
      ...DEFAULT_ONBOARDING_STATE,
      completed: true,
    });
    const reset = resetOnboardingState();
    expect(reset.completed).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      completed: false,
    });
  });
});
