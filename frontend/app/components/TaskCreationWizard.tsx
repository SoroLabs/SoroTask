'use client';

import React, { useState, useCallback } from 'react';
import { z } from 'zod';
import { useWizard } from '@/hooks/useWizard';

const targetContractSchema = z.object({
  targetContractId: z.string().min(1, 'Contract address is required'),
});

const functionSchema = z.object({
  functionName: z.string().min(1, 'Function name is required'),
  functionArgs: z.string().optional(),
});

const triggerSchema = z.object({
  cronInterval: z.string().min(1, 'Interval is required'),
});

const gasSchema = z.object({
  gasDeposit: z.string().min(1, 'Gas deposit is required'),
});

enum WizardStep {
  TARGET_CONTRACT = 1,
  FUNCTION_AND_ARGS = 2,
  TRIGGER_AND_SIMULATION = 3,
  GAS_DEPOSIT = 4,
}

const STORAGE_KEY = 'task-wizard-draft';

interface TaskCreationWizardProps {
  onComplete?: (data: TaskWizardFormData) => void;
  onCancel?: () => void;
}

export interface TaskWizardFormData {
  targetContractId: string;
  functionName: string;
  functionArgs?: string;
  cronInterval: string;
  gasDeposit: string;
}

function loadDraft(): Partial<TaskWizardFormData> | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveDraft(data: Partial<TaskWizardFormData>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function TaskCreationWizard({ onComplete, onCancel }: TaskCreationWizardProps) {
  const [currentStep, setCurrentStep] = useState(WizardStep.TARGET_CONTRACT);
  const [formData, setFormData] = useState<Partial<TaskWizardFormData>>(() => loadDraft() || {});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateField = useCallback((field: keyof TaskWizardFormData, value: string) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };
      saveDraft(updated);
      return updated;
    });
  }, []);

  const validateStep = (step: WizardStep): boolean => {
    let schema: z.ZodSchema;
    let dataToValidate: Record<string, unknown>;

    switch (step) {
      case WizardStep.TARGET_CONTRACT:
        schema = targetContractSchema;
        dataToValidate = { targetContractId: formData.targetContractId };
        break;
      case WizardStep.FUNCTION_AND_ARGS:
        schema = functionSchema;
        dataToValidate = { functionName: formData.functionName, functionArgs: formData.functionArgs };
        break;
      case WizardStep.TRIGGER_AND_SIMULATION:
        schema = triggerSchema;
        dataToValidate = { cronInterval: formData.cronInterval };
        break;
      case WizardStep.GAS_DEPOSIT:
        schema = gasSchema;
        dataToValidate = { gasDeposit: formData.gasDeposit };
        break;
    }

    const result = schema.safeParse(dataToValidate);
    if (!result.success) {
      const newErrors: Record<string, string> = {};
      result.error.errors.forEach((e) => {
        newErrors[e.path[0] as string] = e.message;
      });
      setErrors(newErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, WizardStep.GAS_DEPOSIT));
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, WizardStep.TARGET_CONTRACT));
  };

  const handleSubmit = () => {
    if (validateStep(WizardStep.GAS_DEPOSIT)) {
      const completeData: TaskWizardFormData = {
        targetContractId: formData.targetContractId!,
        functionName: formData.functionName!,
        functionArgs: formData.functionArgs,
        cronInterval: formData.cronInterval!,
        gasDeposit: formData.gasDeposit!,
      };
      clearDraft();
      onComplete?.(completeData);
    }
  };

  const steps = [
    { id: WizardStep.TARGET_CONTRACT, label: 'Target Contract', description: 'Set the contract to automate' },
    { id: WizardStep.FUNCTION_AND_ARGS, label: 'Function & Args', description: 'Define the function to call' },
    { id: WizardStep.TRIGGER_AND_SIMULATION, label: 'Trigger & Simulation', description: 'Set schedule and preview' },
    { id: WizardStep.GAS_DEPOSIT, label: 'Gas Deposit', description: 'Add gas for execution' },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-slate-900 rounded-xl border border-slate-800">
      {/* Step indicators */}
      <div className="flex items-center justify-between mb-8">
        {steps.map((step, idx) => (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-colors ${
                  currentStep === step.id
                    ? 'bg-blue-600 text-white'
                    : currentStep > step.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-700 text-slate-400'
                }`}
              >
                {currentStep > step.id ? '✓' : step.id}
              </div>
              <span className="text-xs mt-1 text-slate-400">{step.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`flex-1 h-1 mx-2 ${currentStep > step.id ? 'bg-emerald-600' : 'bg-slate-700'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Current step content */}
      <div className="mb-6 min-h-[200px]">
        {currentStep === WizardStep.TARGET_CONTRACT && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-100">Target Contract</h2>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Contract Address
              </label>
              <input
                type="text"
                value={formData.targetContractId || ''}
                onChange={(e) => updateField('targetContractId', e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100"
                placeholder="C..."
              />
              {errors.targetContractId && (
                <p className="text-red-400 text-sm mt-1">{errors.targetContractId}</p>
              )}
            </div>
          </div>
        )}

        {currentStep === WizardStep.FUNCTION_AND_ARGS && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-100">Function & Arguments</h2>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Function Name</label>
              <input
                type="text"
                value={formData.functionName || ''}
                onChange={(e) => updateField('functionName', e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100"
                placeholder="harvest_yield"
              />
              {errors.functionName && <p className="text-red-400 text-sm mt-1">{errors.functionName}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Function Arguments (JSON)
              </label>
              <textarea
                value={formData.functionArgs || ''}
                onChange={(e) => updateField('functionArgs', e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 font-mono text-sm"
                placeholder='{"param1": "value1"}'
                rows={3}
              />
            </div>
          </div>
        )}

        {currentStep === WizardStep.TRIGGER_AND_SIMULATION && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-100">Trigger & Simulation</h2>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Cron Interval</label>
              <input
                type="text"
                value={formData.cronInterval || ''}
                onChange={(e) => updateField('cronInterval', e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100"
                placeholder="0 * * * *"
              />
              {errors.cronInterval && <p className="text-red-400 text-sm mt-1">{errors.cronInterval}</p>}
            </div>
          </div>
        )}

        {currentStep === WizardStep.GAS_DEPOSIT && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-100">Gas Deposit</h2>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Gas Amount (XLM)
              </label>
              <input
                type="text"
                value={formData.gasDeposit || ''}
                onChange={(e) => updateField('gasDeposit', e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100"
                placeholder="10"
              />
              {errors.gasDeposit && <p className="text-red-400 text-sm mt-1">{errors.gasDeposit}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors"
        >
          Cancel
        </button>
        <div className="space-x-3">
          {currentStep > WizardStep.TARGET_CONTRACT && (
            <button
              onClick={handleBack}
              className="px-4 py-2 bg-slate-700 text-slate-100 rounded-lg hover:bg-slate-600 transition-colors"
            >
              Back
            </button>
          )}
          {currentStep < WizardStep.GAS_DEPOSIT ? (
            <button
              onClick={handleNext}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors"
            >
              Complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}