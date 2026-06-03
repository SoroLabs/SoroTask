import type { OnboardingStep } from "./types";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to SoroTask",
    body: "This short tour highlights where you create tasks, monitor keepers, and connect a wallet. You can skip anytime and resume later from Settings.",
  },
  {
    id: "board",
    title: "Task board",
    body: "Organize automation tasks on the board. Drag cards between columns to track progress.",
    targetSelector: '[data-onboarding="board"]',
    route: "/board",
  },
  {
    id: "dashboard",
    title: "Analytics dashboard",
    body: "Customize widgets to track volume, keeper health, and alerts at a glance.",
    targetSelector: '[data-onboarding="dashboard"]',
    route: "/dashboard",
  },
  {
    id: "keeper-metrics",
    title: "Keeper performance",
    body: "Review execution success rates, fees, and cycle timing from live keeper metrics.",
    targetSelector: '[data-onboarding="keeper-metrics"]',
    route: "/keeper-metrics",
  },
  {
    id: "wallet",
    title: "Wallet & batch signing",
    body: "Connect Freighter or a hardware wallet, then batch multiple task registrations into one signed transaction.",
    targetSelector: '[data-onboarding="wallet"]',
    route: "/settings",
  },
];
