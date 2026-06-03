"use client";

import { OnboardingProvider } from "@/src/components/onboarding/OnboardingProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <OnboardingProvider>{children}</OnboardingProvider>;
}
