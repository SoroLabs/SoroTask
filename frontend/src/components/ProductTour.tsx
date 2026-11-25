"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FiCompass,
  FiX,
  FiArrowRight,
  FiArrowLeft,
  FiCheckCircle,
  FiAward,
  FiZap,
} from "react-icons/fi";

export interface TourStep {
  id: string;
  title: string;
  description: string;
  targetSelector?: string;
  gamifiedAction?: string;
}

const TOUR_STEPS: TourStep[] = [
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

const STORAGE_KEY = "sorotask_product_tour_state";

interface TourState {
  completed: boolean;
  dismissed: boolean;
  currentStep: number;
  rewardClaimed: boolean;
}

export function ProductTour() {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: TourState = JSON.parse(stored);
        return !parsed.completed && !parsed.dismissed;
      }
      return true;
    } catch {
      return true;
    }
  });

  const [currentStepIndex, setCurrentStepIndex] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: TourState = JSON.parse(stored);
        return parsed.currentStep || 0;
      }
      return 0;
    } catch {
      return 0;
    }
  });

  const [rewardClaimed, setRewardClaimed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: TourState = JSON.parse(stored);
        return parsed.rewardClaimed ?? false;
      }
      return false;
    } catch {
      return false;
    }
  });

  const [isDeployingSimulated, setIsDeployingSimulated] = useState(false);

  const saveState = useCallback((updates: Partial<TourState>) => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const current: TourState = stored
        ? JSON.parse(stored)
        : {
            completed: false,
            dismissed: false,
            currentStep: 0,
            rewardClaimed: false,
          };
      const next = { ...current, ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn("Failed to save tour state", e);
    }
  }, []);

  // Scroll to target element
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const step = TOUR_STEPS[currentStepIndex];
    if (step.targetSelector) {
      const el = document.querySelector(step.targetSelector);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [isOpen, currentStepIndex]);

  const handleNext = () => {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      const nextIndex = currentStepIndex + 1;
      setCurrentStepIndex(nextIndex);
      saveState({ currentStep: nextIndex });
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      const prevIndex = currentStepIndex - 1;
      setCurrentStepIndex(prevIndex);
      saveState({ currentStep: prevIndex });
    }
  };

  const handleDismiss = () => {
    setIsOpen(false);
    saveState({ dismissed: true });
  };

  const handleReplay = () => {
    setCurrentStepIndex(0);
    setIsOpen(true);
    saveState({ completed: false, dismissed: false, currentStep: 0 });
  };

  const handleSimulateAndClaim = () => {
    setIsDeployingSimulated(true);
    setTimeout(() => {
      setIsDeployingSimulated(false);
      setRewardClaimed(true);
      saveState({ completed: true, rewardClaimed: true });
    }, 800);
  };

  const handleFinish = () => {
    setIsOpen(false);
    saveState({ completed: true });
  };

  const currentStep = TOUR_STEPS[currentStepIndex];

  return (
    <>
      {/* Replay trigger button */}
      {!isOpen && (
        <button
          onClick={handleReplay}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40 border border-emerald-400/40 transition hover:scale-105"
          data-testid="start-tour-btn"
          aria-label="Start Product Tour"
        >
          <FiCompass className="text-sm animate-pulse" />
          <span>Product Tour</span>
          {rewardClaimed && (
            <span className="flex items-center text-[10px] bg-emerald-800 px-1.5 py-0.5 rounded-full font-bold">
              ✓ 500 XLM
            </span>
          )}
        </button>
      )}

      {/* Tour Overlay & Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          data-testid="product-tour-modal"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
            onClick={handleDismiss}
          />

          {/* Modal Container */}
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-neutral-900 border border-emerald-500/30 p-6 shadow-2xl text-white animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                <FiCompass className="text-base" />
                <span>
                  Onboarding Tour ({currentStepIndex + 1}/{TOUR_STEPS.length})
                </span>
              </div>
              <button
                onClick={handleDismiss}
                className="text-neutral-400 hover:text-white transition p-1"
                aria-label="Dismiss tour"
                data-testid="tour-dismiss-btn"
              >
                <FiX className="text-lg" />
              </button>
            </div>

            {/* Step Content */}
            <div className="py-4">
              <h3
                className="text-lg font-bold text-white mb-2"
                data-testid="tour-step-title"
              >
                {currentStep.title}
              </h3>
              <p
                className="text-neutral-300 text-sm leading-relaxed"
                data-testid="tour-step-description"
              >
                {currentStep.description}
              </p>

              {/* Gamified Step Special Widget */}
              {currentStep.gamifiedAction === "claim-reward" && (
                <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-emerald-950/60 to-teal-950/60 border border-emerald-500/40">
                  {rewardClaimed ? (
                    <div
                      className="text-center py-2"
                      data-testid="tour-reward-claimed"
                    >
                      <FiAward className="mx-auto text-3xl text-amber-400 mb-2 animate-bounce" />
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
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-sm transition shadow-lg shadow-emerald-500/20"
                        data-testid="tour-claim-reward-btn"
                      >
                        <FiZap />
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
            <div className="flex gap-1.5 py-2 mb-4">
              {TOUR_STEPS.map((step, idx) => (
                <div
                  key={step.id}
                  className={`h-1.5 flex-1 rounded-full transition-all ${
                    idx === currentStepIndex
                      ? "bg-emerald-400"
                      : idx < currentStepIndex
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
                {currentStepIndex > 0 && (
                  <button
                    onClick={handlePrev}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium transition"
                    data-testid="tour-prev-btn"
                  >
                    <FiArrowLeft />
                    Back
                  </button>
                )}

                {currentStepIndex < TOUR_STEPS.length - 1 ? (
                  <button
                    onClick={handleNext}
                    className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
                    data-testid="tour-next-btn"
                  >
                    Next
                    <FiArrowRight />
                  </button>
                ) : (
                  <button
                    onClick={handleFinish}
                    className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold transition"
                    data-testid="tour-finish-btn"
                  >
                    <FiCheckCircle />
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
