import { useState, useCallback } from 'react';

export interface UseWizardOptions<T> {
  initialStep?: number;
  totalSteps: number;
  onComplete?: (data: T) => void;
}

export interface UseWizardReturn<T> {
  currentStep: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  next: () => void;
  back: () => void;
  goToStep: (step: number) => void;
  setData: (data: Partial<T>) => void;
  data: Partial<T>;
}

export function useWizard<T extends Record<string, unknown>>(
  options: UseWizardOptions<T>
): UseWizardReturn<T> {
  const { initialStep = 1, totalSteps, onComplete } = options;
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [data, setData] = useState<Partial<T>>({});

  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === totalSteps;

  const next = useCallback(() => {
    setCurrentStep((prev) => {
      const nextStep = Math.min(prev + 1, totalSteps);
      if (nextStep === totalSteps && prev === totalSteps) {
        onComplete?.(data as T);
      }
      return nextStep;
    });
  }, [totalSteps, data, onComplete]);

  const back = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.min(Math.max(step, 1), totalSteps));
  }, [totalSteps]);

  const setWizardData = useCallback((newData: Partial<T>) => {
    setData((prev) => ({ ...prev, ...newData }));
  }, []);

  return {
    currentStep,
    isFirstStep,
    isLastStep,
    next,
    back,
    goToStep,
    setData: setWizardData,
    data,
  };
}