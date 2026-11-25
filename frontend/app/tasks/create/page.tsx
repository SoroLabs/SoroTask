"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { simulateTaskCall, formatXlm } from '@/src/lib/soroban/task-simulation';
import React, { useState } from "react";
import { useStellarWallet } from "@/context/StellarWalletContext";
import {
  TaskWizardFormData,
  WizardStep,
  SimulationResult,
} from "@/types/task-wizard.types";
import TaskCreationForm from "@/app/components/TaskCreationForm";
import { WalletButton } from "@/app/components/WalletButton";
import { VoiceAssistant } from "@/src/components/VoiceAssistant";

const INITIAL_FORM_DATA: TaskWizardFormData = {
  targetContractId: '',
  functionName: '',
  functionArgs: '[]',
  cronInterval: '0 * * * *',
  gasDeposit: '10',
  targetContractId: "",
  functionName: "",
  functionArgs: "{}",
  cronInterval: "0 * * * *",
  gasDeposit: "10",
};

export default function CreateTaskWizardPage() {
  const { address, isConnected, network } = useStellarWallet();
  const [step, setStep] = useState<WizardStep>(WizardStep.TARGET_CONTRACT);
  const [formData, setFormData] =
    useState<TaskWizardFormData>(INITIAL_FORM_DATA);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const simulationSequence = useRef(0);
  const sorobanNetwork = network === 'PUBLIC' ? 'mainnet' : 'testnet';

  const updateFormData = (field: keyof TaskWizardFormData, value: string) => {
    if (field === 'targetContractId' || field === 'functionName' || field === 'functionArgs') {
      simulationSequence.current += 1;
      setSimResult(null);
    }
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleRunSimulation = useCallback(async () => {
    const requestId = ++simulationSequence.current;
    setIsSimulating(true);
    setSimResult(null);

    try {
      if (!address) {
        throw new Error('Connect a Stellar wallet before simulating this call.');
      // Mock RPC call simulating Soroban transaction execution (simulateTransaction)
      await new Promise((resolve) => setTimeout(resolve, 1200));

      if (!formData.targetContractId.startsWith("C")) {
        throw new Error("Invalid Soroban Contract ID format.");
      }
      const result = await simulateTaskCall({
        contractId: formData.targetContractId,
        functionName: formData.functionName,
        functionArgs: formData.functionArgs,
        sourceAddress: address,
        network: sorobanNetwork,
      });
      if (requestId !== simulationSequence.current) return;
      setSimResult({
        success: true,
        minResourceFee: `${formatXlm(result.minResourceFeeStroops)} XLM`,
        networkFee: `${formatXlm(result.networkFeeStroops)} XLM`,
        totalFee: `${formatXlm(result.totalFeeStroops)} XLM`,
        estimatedCpuInstructions: result.cpuInstructions,
        storageReadBytes: result.storageReadBytes,
        storageWriteBytes: result.storageWriteBytes,
        readOnlyEntries: result.readOnlyEntries,
        readWriteEntries: result.readWriteEntries,
        stateChanges: result.stateChanges,
        trace: result.trace,
        minResourceFee: "0.05 XLM",
        estimatedCpuInstructions: 145000,
        estimatedMemoryBytes: 24500,
      });
    } catch (err) {
      if (requestId !== simulationSequence.current) return;
      setSimResult({
        success: false,
        minResourceFee: "0",
        estimatedCpuInstructions: 0,
        errorMessage: err instanceof Error ? err.message : 'Simulation failed unexpectedly.',
        estimatedMemoryBytes: 0,
        errorMessage: err.message || "Simulation reverted or failed.",
      });
    } finally {
      if (requestId === simulationSequence.current) setIsSimulating(false);
    }
  }, [address, formData.functionArgs, formData.functionName, formData.targetContractId, sorobanNetwork]);

  useEffect(() => {
    if (step !== WizardStep.TRIGGER_AND_SIMULATION) return;
    const timeout = setTimeout(() => void handleRunSimulation(), 300);
    return () => clearTimeout(timeout);
  }, [handleRunSimulation, step]);

  const calculateMonthlyEstimate = (): string => {
    const baseDeposit = parseFloat(formData.gasDeposit) || 0;
    // Estimated executions per month based on interval (simplified for calculation display)
    const estimatedExecutions = 720;
    const estCost = (baseDeposit * 0.05).toFixed(2);
    return `${estCost} XLM (~${estimatedExecutions} executions)`;
  };

  const handleNext = () => {
    if (step === WizardStep.TRIGGER_AND_SIMULATION && !simResult?.success) {
      return;
    }
    setStep((prev) => Math.min(prev + 1, 4) as WizardStep);
  };

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 1) as WizardStep);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 bg-card border rounded-xl shadow-md my-10 text-card-foreground">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Create Automation Task</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect a wallet, then register a recurring Soroban task.
          </p>
        </div>
        <WalletButton />
      </header>

      {/* Voice & NLP Assistant */}
      <div className="mb-8">
        <VoiceAssistant
          onApplyIntent={(intent) => {
            setFormData((prev) => ({
              ...prev,
              ...(intent.targetContractId
                ? { targetContractId: intent.targetContractId }
                : {}),
              ...(intent.functionName
                ? { functionName: intent.functionName }
                : {}),
              ...(intent.functionArgs
                ? { functionArgs: intent.functionArgs }
                : {}),
              ...(intent.cronInterval
                ? { cronInterval: intent.cronInterval }
                : {}),
              ...(intent.gasDeposit ? { gasDeposit: intent.gasDeposit } : {}),
            }));
          }}
        />
      </div>

      {/* Wizard Progress Stepper */}
      <div className="flex justify-between items-center mb-8 border-b pb-4">
        {[
          "1. Target Contract",
          "2. Function & Args",
          "3. Trigger & Simulation",
          "4. Gas Deposit",
        ].map((label, idx) => {
          const stepNum = idx + 1;
          const isActive = step === stepNum;
          const isCompleted = step > stepNum;

          return (
            <div
              key={label}
              className={`flex items-center gap-2 text-sm font-semibold ${
                isActive
                  ? "text-primary"
                  : isCompleted
                    ? "text-muted-foreground line-through"
                    : "text-muted-foreground/50"
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {stepNum}
              </span>
              <span>{label}</span>
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="min-h-[260px]">
        {step === WizardStep.TARGET_CONTRACT && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold">
              Step 1: Specify Target Soroban Contract
            </h2>
            <p className="text-sm text-muted-foreground">
              Enter the valid C-address of the deployed Soroban smart contract.
            </p>
            <input
              type="text"
              placeholder="e.g. CA7Q3...102X"
              value={formData.targetContractId}
              onChange={(e) =>
                updateFormData("targetContractId", e.target.value)
              }
              className="w-full p-2.5 border rounded-md bg-background focus:ring-2 focus:ring-primary text-sm font-mono"
            />
          </div>
        )}

        {step === WizardStep.FUNCTION_AND_ARGS && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold">
              Step 2: Function Selection & Arguments
            </h2>
            <div>
              <label className="block text-sm font-medium mb-1">
                Function Name
              </label>
              <input
                type="text"
                placeholder="e.g. execute_cron"
                value={formData.functionName}
                onChange={(e) => updateFormData("functionName", e.target.value)}
                className="w-full p-2.5 border rounded-md bg-background focus:ring-2 focus:ring-primary text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                JSON Arguments
              </label>
              <textarea
                rows={4}
                value={formData.functionArgs}
                onChange={(e) => updateFormData("functionArgs", e.target.value)}
                className="w-full p-2.5 border rounded-md bg-background focus:ring-2 focus:ring-primary text-sm font-mono"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Provide a JSON array. To specify an address or integer type, use an object such as
                {" "}{"{\"__type\":\"address\",\"value\":\"G...\"}"}.
              </p>
            </div>
          </div>
        )}

        {step === WizardStep.TRIGGER_AND_SIMULATION && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold">
              Step 3: Trigger Interval & Pre-flight Simulation
            </h2>
            <div>
              <label className="block text-sm font-medium mb-1">
                Cron Schedule
              </label>
              <input
                type="text"
                value={formData.cronInterval}
                onChange={(e) => updateFormData("cronInterval", e.target.value)}
                className="w-full p-2.5 border rounded-md bg-background focus:ring-2 focus:ring-primary text-sm font-mono"
              />
            </div>

            <div className="p-4 border rounded-lg bg-muted/40 space-y-3">
              <p className="text-xs text-muted-foreground">
                Simulation runs automatically and again when the contract call changes. No transaction is signed or submitted.
              </p>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">
                  Soroban Pre-flight RPC Check
                </span>
                <button
                  type="button"
                  onClick={() => void handleRunSimulation()}
                  disabled={isSimulating}
                  className="px-3 py-1.5 text-xs font-semibold bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                >
                  {isSimulating ? "Simulating..." : "Run Simulation"}
                </button>
              </div>

              {simResult && (
                <div
                  className={`p-3 rounded-md text-xs font-mono border ${
                    simResult.success
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
                      : "bg-destructive/10 border-destructive/30 text-destructive"
                  }`}
                >
                  {simResult.success ? (
                    <div>
                      <p className="font-bold">✓ Simulation Successful</p>
                      <p>Resource Fee: {simResult.minResourceFee}</p>
                      {simResult.networkFee ? <p>Median Network Inclusion Fee: {simResult.networkFee}</p> : null}
                      {simResult.totalFee ? <p>Total Estimated Fee: {simResult.totalFee}</p> : null}
                      <p>CPU Instructions: {simResult.estimatedCpuInstructions}</p>
                      <p>Storage I/O: {simResult.storageReadBytes ?? 0} bytes read / {simResult.storageWriteBytes ?? 0} bytes written</p>
                      <p>Storage footprint: {simResult.readOnlyEntries ?? 0} read-only / {simResult.readWriteEntries ?? 0} read-write entries</p>
                      {simResult.stateChanges ? (
                        <p>Ledger delta: {simResult.stateChanges.created} created / {simResult.stateChanges.updated} updated / {simResult.stateChanges.removed} removed</p>
                      ) : null}
                      {simResult.trace?.length ? (
                        <ol className="mt-2 space-y-1 border-t border-current/20 pt-2">
                          {simResult.trace.map((item, index) => (
                            <li key={`${item.step}-${index}`}>
                              <strong>{index + 1}. {item.step}:</strong> {item.detail}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      <p>
                        CPU Instructions: {simResult.estimatedCpuInstructions}
                      </p>
                    </div>
                  ) : (
                    <p>✗ Simulation Error: {simResult.errorMessage}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {step === WizardStep.GAS_DEPOSIT && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold">
              Step 4: Gas Deposit & Activation
            </h2>
            <div>
              <label className="block text-sm font-medium mb-1">
                Initial XLM Gas Balance
              </label>
              <input
                type="number"
                value={formData.gasDeposit}
                onChange={(e) => updateFormData("gasDeposit", e.target.value)}
                className="w-full p-2.5 border rounded-md bg-background focus:ring-2 focus:ring-primary text-sm"
              />
            </div>

            <div className="p-4 border rounded-lg bg-primary/5 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">
                Estimated Monthly Execution Cost
              </p>
              <p className="text-lg font-bold text-primary">
                {calculateMonthlyEstimate()}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="flex justify-between items-center mt-8 border-t pt-4">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 1}
          className="px-4 py-2 text-sm border rounded-md disabled:opacity-40"
        >
          Back
        </button>

        {step < 4 ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={
              step === WizardStep.TRIGGER_AND_SIMULATION && !simResult?.success
            }
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40"
          >
            Next Step
          </button>
        ) : (
          <button
            type="button"
            disabled={!isConnected}
            className="px-6 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-40"
          >
            {isConnected ? "Register & Deposit Gas" : "Connect Wallet First"}
          </button>
        )}
      </div>

      {/* Quick Task Creation Form */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 className="text-xl font-bold mb-4">Quick Task Registration</h2>
        <TaskCreationForm />
      </section>
    </div>
  );
}
