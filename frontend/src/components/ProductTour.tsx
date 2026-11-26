"use client";

import React, {
  useReducer,
  useEffect,
  useCallback,
  useContext,
  useRef,
} from "react";
import {
  FiCompass,
  FiX,
  FiArrowRight,
  FiArrowLeft,
  FiCheckCircle,
  FiAward,
  FiZap,
} from "react-icons/fi";
import WalletContext from "@/src/context/WalletContext";

export interface TourStep {
  id: string;
  title: string;
  description: string;
  targetSelector?: string;
  gamifiedAction?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to SoroTask",
    description:
      "SoroTask is the premier autonomous task automation network on Soroban & Stellar. Let’s take a 60-second guided tour to launch your first recurring task.",
  },
  {
    id: "wallet",
    title: "1. Connect Your Wallet",
    description:
      "Connect your Freighter or Web3 wallet. All transaction fees during testing are covered using Testnet lumens.",
    targetSelector: '[data-tour="wallet-slot"]',
  },
  {
    id: "tasks",
    title: "2. Task Creation & Resolvers",
    description:
      "Set target contract addresses, method signatures, execution intervals (cron/ledgers), and gas escrow limits.",
    targetSelector: '[data-tour="quick-links"]',
  },
  {
    id: "execution",
    title: "3. Autonomous Keeper Network",
    description:
      "Independent keepers monitor condition resolvers off-chain and submit transactions on-chain the moment trigger criteria are satisfied.",
    targetSelector: '[data-tour="command-center"]',
  },
  {
    id: "gamified-reward",
    title: "4. Complete Tutorial & Earn Reward",
    description:
      "Click the button below to simulate deploying your first automated keeper task and claim 500 TEST-XLM simulated faucet tokens!",
    gamifiedAction: "claim-reward",
  },
];

export const STORAGE_KEY = "sorotask_product_tour_state";

export type TourPhase =
  | "unmounted"
  | "active"
  | "simulating"
  | "completed"
  | "dismissed";

export interface PersistedTourState {
  completed: boolean;
  dismissed: boolean;
  currentStep: number;
  rewardClaimed: boolean;
  updatedAt?: string;
  accountId?: string | null;
}

export interface OnboardingMachineState {
  phase: TourPhase;
  currentStep: number;
  rewardClaimed: boolean;
  accountId: string | null;
}

export type TourAction =
  | {
      type: "HYDRATE";
      persisted: PersistedTourState | null;
      accountId: string | null;
    }
  | {
      type: "SYNC_ACCOUNT";
      persisted: PersistedTourState | null;
      accountId: string | null;
    }
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "GO_TO_STEP"; stepIndex: number }
  | { type: "START_SIMULATION" }
  | { type: "COMPLETE_SIMULATION" }
  | { type: "FINISH" }
  | { type: "DISMISS" }
  | { type: "REPLAY" };

export const INITIAL_TOUR_STATE: OnboardingMachineState = {
  phase: "unmounted",
  currentStep: 0,
  rewardClaimed: false,
  accountId: null,
};

function clampStep(step: number): number {
  if (!Number.isFinite(step) || step < 0) return 0;
  if (step >= TOUR_STEPS.length) return TOUR_STEPS.length - 1;
  return Math.floor(step);
}

function resolvePhaseFromPersisted(
  persisted: PersistedTourState | null,
): Exclude<TourPhase, "unmounted" | "simulating"> {
  if (!persisted) return "active";
  if (persisted.completed) return "completed";
  if (persisted.dismissed) return "dismissed";
  return "active";
}

export function tourReducer(
  state: OnboardingMachineState,
  action: TourAction,
): OnboardingMachineState {
  switch (action.type) {
    case "HYDRATE":
    case "SYNC_ACCOUNT": {
      const phase = resolvePhaseFromPersisted(action.persisted);
      return {
        phase,
        currentStep: clampStep(action.persisted?.currentStep ?? 0),
        rewardClaimed: Boolean(action.persisted?.rewardClaimed),
        accountId: action.accountId,
      };
    }

    case "NEXT_STEP": {
      if (state.phase !== "active") return state;
      if (state.currentStep >= TOUR_STEPS.length - 1) return state;
      return {
        ...state,
        currentStep: state.currentStep + 1,
      };
    }

    case "PREV_STEP": {
      if (state.phase !== "active") return state;
      if (state.currentStep <= 0) return state;
      return {
        ...state,
        currentStep: state.currentStep - 1,
      };
    }

    case "GO_TO_STEP": {
      if (state.phase !== "active") return state;
      return {
        ...state,
        currentStep: clampStep(action.stepIndex),
      };
    }

    case "START_SIMULATION": {
      if (state.phase !== "active" || state.rewardClaimed) return state;
      return {
        ...state,
        phase: "simulating",
      };
    }

    case "COMPLETE_SIMULATION": {
      if (state.phase !== "simulating") return state;
      return {
        ...state,
        phase: "active",
        rewardClaimed: true,
      };
    }

    case "FINISH": {
      if (state.phase === "unmounted") return state;
      return {
        ...state,
        phase: "completed",
      };
    }

    case "DISMISS": {
      if (state.phase === "unmounted") return state;
      return {
        ...state,
        phase: "dismissed",
      };
    }

    case "REPLAY": {
      if (state.phase === "unmounted") return state;
      return {
        ...state,
        phase: "active",
        currentStep: 0,
      };
    }

    default:
      return state;
  }
}

export function getAccountStorageKey(accountId: string | null): string {
  return accountId ? `${STORAGE_KEY}:${accountId}` : STORAGE_KEY;
}

function readPersistedState(key: string): PersistedTourState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTourState>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      completed: Boolean(parsed.completed),
      dismissed: Boolean(parsed.dismissed),
      currentStep: clampStep(parsed.currentStep ?? 0),
      rewardClaimed: Boolean(parsed.rewardClaimed),
      updatedAt: parsed.updatedAt,
      accountId: parsed.accountId ?? null,
    };
  } catch {
    return null;
  }
}

function writePersistedState(
  state: PersistedTourState,
  accountId: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedTourState = {
      ...state,
      accountId,
      updatedAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify(payload);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    if (accountId) {
      window.localStorage.setItem(getAccountStorageKey(accountId), serialized);
    }
  } catch (e) {
    console.warn("Failed to save tour state", e);
  }
}

function toPersistedState(
  machineState: OnboardingMachineState,
): PersistedTourState {
  return {
    completed:
      machineState.phase === "completed" || machineState.rewardClaimed,
    dismissed: machineState.phase === "dismissed",
    currentStep: machineState.currentStep,
    rewardClaimed: machineState.rewardClaimed,
    accountId: machineState.accountId,
  };
}

export interface ProductTourProps {
  /** Optional account identifier override for profile synchronization */
  accountId?: string | null;
}

export function ProductTour({ accountId: propAccountId }: ProductTourProps = {}) {
  const walletCtx = useContext(WalletContext);
  const resolvedAccountId =
    propAccountId !== undefined
      ? propAccountId
      : (walletCtx?.session?.publicKey ?? null);

  const [state, dispatch] = useReducer(tourReducer, INITIAL_TOUR_STATE);
  const simulationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasHydratedRef = useRef(false);

  const clearSimulationTimer = useCallback(() => {
    if (simulationTimerRef.current !== null) {
      clearTimeout(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
  }, []);

  // Hydrate state machine only after client mount to prevent SSR hydration mismatches
  useEffect(() => {
    const accountState = resolvedAccountId
      ? readPersistedState(getAccountStorageKey(resolvedAccountId))
      : null;
    const globalState = readPersistedState(STORAGE_KEY);
    const effectiveState = accountState ?? globalState;

    // Synchronize anonymous completion into newly connected account profile
    if (resolvedAccountId && !accountState && globalState) {
      writePersistedState(globalState, resolvedAccountId);
    }

    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      dispatch({
        type: "HYDRATE",
        persisted: effectiveState,
        accountId: resolvedAccountId,
      });
    } else {
      dispatch({
        type: "SYNC_ACCOUNT",
        persisted: effectiveState,
        accountId: resolvedAccountId,
      });
    }
  }, [resolvedAccountId]);

  // Cross-tab storage synchronization
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      const accountKey = getAccountStorageKey(resolvedAccountId);
      if (event.key !== STORAGE_KEY && event.key !== accountKey) return;
      const latest =
        (resolvedAccountId ? readPersistedState(accountKey) : null) ??
        readPersistedState(STORAGE_KEY);
      dispatch({
        type: "SYNC_ACCOUNT",
        persisted: latest,
        accountId: resolvedAccountId,
      });
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [resolvedAccountId]);

  // Clean up any pending simulation timer on unmount
  useEffect(() => clearSimulationTimer, [clearSimulationTimer]);

  const isModalOpen = state.phase === "active" || state.phase === "simulating";
  const isDeployingSimulated = state.phase === "simulating";

  // Scroll to target element when active step changes
  useEffect(() => {
    if (!isModalOpen) return;
    const step = TOUR_STEPS[state.currentStep];
    if (step?.targetSelector) {
      const el = document.querySelector(step.targetSelector);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [isModalOpen, state.currentStep]);

  const persistNextState = useCallback(
    (next: OnboardingMachineState) => {
      writePersistedState(toPersistedState(next), resolvedAccountId);
    },
    [resolvedAccountId],
  );

  const handleNext = useCallback(() => {
    const next = tourReducer(state, { type: "NEXT_STEP" });
    dispatch({ type: "NEXT_STEP" });
    persistNextState(next);
  }, [state, persistNextState]);

  const handlePrev = useCallback(() => {
    const next = tourReducer(state, { type: "PREV_STEP" });
    dispatch({ type: "PREV_STEP" });
    persistNextState(next);
  }, [state, persistNextState]);

  const handleDismiss = useCallback(() => {
    clearSimulationTimer();
    const next = tourReducer(state, { type: "DISMISS" });
    dispatch({ type: "DISMISS" });
    persistNextState(next);
  }, [clearSimulationTimer, state, persistNextState]);

  const handleReplay = useCallback(() => {
    clearSimulationTimer();
    const next = tourReducer(state, { type: "REPLAY" });
    dispatch({ type: "REPLAY" });
    writePersistedState(
      {
        completed: false,
        dismissed: false,
        currentStep: 0,
        rewardClaimed: state.rewardClaimed,
        accountId: resolvedAccountId,
      },
      resolvedAccountId,
    );
  }, [clearSimulationTimer, state, resolvedAccountId]);

  const handleSimulateAndClaim = useCallback(() => {
    if (state.phase !== "active" || state.rewardClaimed) return;
    dispatch({ type: "START_SIMULATION" });
    clearSimulationTimer();
    simulationTimerRef.current = setTimeout(() => {
      simulationTimerRef.current = null;
      dispatch({ type: "COMPLETE_SIMULATION" });
      writePersistedState(
        {
          completed: true,
          dismissed: false,
          currentStep: state.currentStep,
          rewardClaimed: true,
          accountId: resolvedAccountId,
        },
        resolvedAccountId,
      );
    }, 800);
  }, [state.phase, state.rewardClaimed, state.currentStep, clearSimulationTimer, resolvedAccountId]);

  const handleFinish = useCallback(() => {
    clearSimulationTimer();
    const next = tourReducer(state, { type: "FINISH" });
    dispatch({ type: "FINISH" });
    persistNextState(next);
  }, [clearSimulationTimer, state, persistNextState]);

  // Keyboard accessibility (Escape to dismiss)
  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isModalOpen, handleDismiss]);

  // Prevent any DOM render until client mount completes to guarantee zero SSR hydration mismatch
  if (state.phase === "unmounted") {
    return null;
  }

  const currentStep = TOUR_STEPS[state.currentStep];

  return (
    <>
      {/* Replay trigger button */}
      {!isModalOpen && (
        <button
          onClick={handleReplay}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40 border border-emerald-400/40 transition hover:scale-105"
          data-testid="start-tour-btn"
          data-tour-phase={state.phase}
          aria-label="Start Product Tour"
        >
          <FiCompass className="text-sm animate-pulse" aria-hidden="true" />
          <span>Product Tour</span>
          {state.rewardClaimed && (
            <span className="flex items-center text-[10px] bg-emerald-800 px-1.5 py-0.5 rounded-full font-bold">
              ✓ 500 XLM
            </span>
          )}
        </button>
      )}

      {/* Tour Overlay & Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          data-testid="product-tour-modal"
          data-tour-phase={state.phase}
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-tour-title"
          aria-describedby="product-tour-description"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
            onClick={handleDismiss}
            aria-hidden="true"
          />

          {/* Modal Container */}
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-neutral-900 border border-emerald-500/30 p-6 shadow-2xl text-white animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                <FiCompass className="text-base" aria-hidden="true" />
                <span>
                  Onboarding Tour ({state.currentStep + 1}/{TOUR_STEPS.length})
                </span>
              </div>
              <button
                onClick={handleDismiss}
                className="text-neutral-400 hover:text-white transition p-1"
                aria-label="Dismiss tour"
                data-testid="tour-dismiss-btn"
              >
                <FiX className="text-lg" aria-hidden="true" />
              </button>
            </div>

            {/* Step Content */}
            <div className="py-4">
              <h3
                id="product-tour-title"
                className="text-lg font-bold text-white mb-2"
                data-testid="tour-step-title"
              >
                {currentStep.title}
              </h3>
              <p
                id="product-tour-description"
                className="text-neutral-300 text-sm leading-relaxed"
                data-testid="tour-step-description"
              >
                {currentStep.description}
              </p>

              {/* Gamified Step Special Widget */}
              {currentStep.gamifiedAction === "claim-reward" && (
                <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-emerald-950/60 to-teal-950/60 border border-emerald-500/40">
                  {state.rewardClaimed ? (
                    <div
                      className="text-center py-2"
                      data-testid="tour-reward-claimed"
                    >
                      <FiAward
                        className="mx-auto text-3xl text-amber-400 mb-2 animate-bounce"
                        aria-hidden="true"
                      />
                      <div className="font-bold text-emerald-300 text-base">
                        Achievement Unlocked!
                      </div>
                      <div className="text-xs text-neutral-300 mt-1">
                        +500 TEST-XLM credited to your simulated account.
                      </div>
                      <div className="inline-block mt-3 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold">
                        🏆 SoroTask Pioneer Badge Granted
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="text-xs text-neutral-400 mb-3">
                        Simulate task registration to complete onboarding and
                        fund your testnet balance.
                      </div>
                      <button
                        onClick={handleSimulateAndClaim}
                        disabled={isDeployingSimulated}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-sm transition shadow-lg shadow-emerald-500/20 disabled:opacity-60"
                        data-testid="tour-claim-reward-btn"
                      >
                        <FiZap aria-hidden="true" />
                        {isDeployingSimulated
                          ? "Deploying Simulated Task..."
                          : "Simulate Task & Claim 500 TEST-XLM"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Progress indicators */}
            <div
              className="flex gap-1.5 py-2 mb-4"
              role="progressbar"
              aria-label="Onboarding tour progress"
              aria-valuemin={1}
              aria-valuemax={TOUR_STEPS.length}
              aria-valuenow={state.currentStep + 1}
            >
              {TOUR_STEPS.map((step, idx) => (
                <div
                  key={step.id}
                  className={`h-1.5 flex-1 rounded-full transition-all ${
                    idx === state.currentStep
                      ? "bg-emerald-400"
                      : idx < state.currentStep
                        ? "bg-emerald-800"
                        : "bg-neutral-800"
                  }`}
                />
              ))}
            </div>

            {/* Actions Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-neutral-800 text-xs">
              <button
                onClick={handleDismiss}
                className="text-neutral-400 hover:text-neutral-200 transition"
                data-testid="tour-skip-btn"
              >
                Skip Tour
              </button>

              <div className="flex items-center gap-2">
                {state.currentStep > 0 && (
                  <button
                    onClick={handlePrev}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium transition"
                    data-testid="tour-prev-btn"
                  >
                    <FiArrowLeft aria-hidden="true" />
                    Back
                  </button>
                )}

                {state.currentStep < TOUR_STEPS.length - 1 ? (
                  <button
                    onClick={handleNext}
                    className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
                    data-testid="tour-next-btn"
                  >
                    Next
                    <FiArrowRight aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    onClick={handleFinish}
                    className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold transition"
                    data-testid="tour-finish-btn"
                  >
                    <FiCheckCircle aria-hidden="true" />
                    Finish Tour
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
