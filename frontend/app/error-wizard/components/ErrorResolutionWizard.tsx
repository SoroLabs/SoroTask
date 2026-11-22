'use client';

import React, { useState } from 'react';
import { useErrorWizard } from '../useErrorWizard';
import { WizardStepCard } from './WizardStepCard';
import type { FailureLog, ResolutionAction } from '../types';
import { useWalletOptional } from '@/app/context/WalletContext';

// ---------------------------------------------------------------------------
// Demo/mock logs — replaced by real backend data in production
// ---------------------------------------------------------------------------

const DEMO_LOGS: FailureLog[] = [
  {
    taskId: 'task-demo-1',
    timestamp: new Date().toISOString(),
    errorCode: 'INSUFFICIENT_GAS',
    errorMessage: 'Ran out of gas during execution',
    context: { gasBudget: 50000, gasUsed: 51000 },
  },
  {
    taskId: 'task-demo-1',
    timestamp: new Date().toISOString(),
    errorCode: 'INVALID_ARGS',
    errorMessage: 'Contract returned error for supplied arguments',
    context: { contractAddress: 'CABC123', functionName: 'harvest' },
  },
];

export function ErrorResolutionWizard() {
  const { openConnectModal } = useWalletOptional();
  const {
    phase,
    steps,
    currentStep,
    currentIndex,
    appliedPatches,
    error,
    analyze,
    applyStep,
    skipStep,
    reset,
  } = useErrorWizard();

  const [rawLogs, setRawLogs] = useState('');
  const [diagnosticPayload, setDiagnosticPayload] = useState('');
  const [parseError, setParseError] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');

  function handleAnalyzeDemoLogs() {
    setParseError('');
    analyze(DEMO_LOGS);
  }

  function handleAnalyzeCustom() {
    setParseError('');
    try {
      const parsed: FailureLog[] = JSON.parse(rawLogs);
      if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of logs');
      analyze(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  function handleApply(patch?: ResolutionAction['patch']) {
    applyStep(patch);
  }

  function handleDiagnosticAnalyze() {
    setParseError('');
    analyze([{
      taskId: 'diagnostic-input',
      timestamp: new Date().toISOString(),
      errorCode: '',
      errorMessage: 'Soroban diagnostic payload',
      diagnosticPayload,
    }]);
  }

  function handleRecovery(action: ResolutionAction) {
    setRecoveryNotice('');
    if (
      action.type === 'reconnect_wallet' ||
      action.type === 'top_up_balance' ||
      action.type === 'switch_network' ||
      action.type === 'approve_token'
    ) {
      openConnectModal();
      setRecoveryNotice(
        action.type === 'approve_token'
          ? 'Wallet panel opened. Verify the token contract, spender, and allowance before signing; this wizard does not submit an approval.'
          : 'Wallet panel opened. Complete the wallet or funding step there, then return and review the task before retrying.',
      );
      return;
    }
    if (action.type === 'wait_and_retry') {
      setRecoveryNotice(
        'No transaction was submitted from this wizard. Retry the task from its task page when the network is available.',
      );
      return;
    }
    if (action.type === 'contact_support') {
      setRecoveryNotice(
        'Share the decoded diagnostic and error code with your SoroTask administrator for investigation.',
      );
      return;
    }
    if (!action.patch) {
      setRecoveryNotice(
        'Review this suggestion and update the contract call from its task page before retrying.',
      );
      return;
    }
    handleApply(action.patch);
  }

  const progress = steps.length > 0
    ? Math.round(((currentIndex) / steps.length) * 100)
    : 0;

  // ---- idle / input ----
  if (phase === 'idle') {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <header>
          <h1 className="text-xl font-bold text-neutral-100">Task Error Resolution Wizard</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Paste failure logs below or use the demo data to begin.
          </p>
        </header>

        <button
          type="button"
          onClick={handleAnalyzeDemoLogs}
          className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
        >
          Analyze demo logs
        </button>

        <div className="space-y-2">
          <label htmlFor="diagnostic-input" className="text-xs font-medium text-neutral-400 block">
            Or paste a Soroban hex diagnostic payload
          </label>
          <textarea
            id="diagnostic-input"
            value={diagnosticPayload}
            onChange={(e) => { setDiagnosticPayload(e.target.value); setParseError(''); }}
            placeholder="0x... or Error(Contract, #2)"
            rows={3}
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500 resize-y"
            aria-label="Soroban diagnostic payload"
          />
          <button
            type="button"
            onClick={handleDiagnosticAnalyze}
            disabled={!diagnosticPayload.trim()}
            className="w-full py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Decode diagnostic
          </button>
        </div>

        <div className="space-y-2">
          <label htmlFor="log-input" className="text-xs font-medium text-neutral-400 block">
            Or paste JSON failure logs
          </label>
          <textarea
            id="log-input"
            value={rawLogs}
            onChange={(e) => { setRawLogs(e.target.value); setParseError(''); }}
            placeholder={'[\n  { "taskId": "...", "errorCode": "INSUFFICIENT_GAS", ... }\n]'}
            rows={6}
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            aria-label="Paste failure logs JSON"
          />
          {parseError && <p role="alert" className="text-xs text-red-400">{parseError}</p>}
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleAnalyzeCustom}
            disabled={!rawLogs.trim()}
            className="w-full py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Analyze logs
          </button>
        </div>
      </div>
    );
  }

  // ---- analyzing ----
  if (phase === 'analyzing') {
    return (
      <div className="flex flex-col items-center gap-4 py-16" role="status" aria-live="polite">
        <div className="w-10 h-10 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" aria-hidden="true" />
        <p className="text-sm text-neutral-400">Analyzing failure logs…</p>
      </div>
    );
  }

  // ---- complete ----
  if (phase === 'complete') {
    const applied = steps.filter((s) => s.status === 'applied').length;
    const skipped = steps.filter((s) => s.status === 'skipped').length;
    return (
      <div className="max-w-xl mx-auto space-y-6 text-center py-8">
        <div className="text-5xl" aria-hidden="true">✅</div>
        <h2 className="text-xl font-bold text-neutral-100">All steps complete</h2>
        <p className="text-sm text-neutral-400">
          {applied} suggestion{applied !== 1 ? 's' : ''} accepted · {skipped} skipped
        </p>

        {Object.keys(appliedPatches).length > 0 && (
          <div
            aria-label="Applied configuration changes"
            className="text-left bg-neutral-800/60 rounded-lg px-4 py-3 space-y-1"
          >
            <p className="text-xs font-semibold text-neutral-400 mb-2">Suggested configuration changes:</p>
            {Object.entries(appliedPatches).map(([field, value]) => (
              <p key={field} className="text-xs font-mono text-blue-300">
                {field}: {value}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={reset}
            className="px-5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm font-medium text-neutral-200 transition-colors"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  // ---- ready: show current step ----
  return (
    <div className="max-w-xl mx-auto space-y-5">
      {/* Progress bar */}
      <div aria-label={`Progress: step ${currentIndex + 1} of ${steps.length}`}>
        <div className="flex justify-between text-xs text-neutral-500 mb-1.5">
          <span>Step {currentIndex + 1} of {steps.length}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${progress}%` }}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Step overview pills */}
      <div className="flex gap-1.5 flex-wrap" aria-hidden="true">
        {steps.map((s, i) => (
          <span
            key={s.id}
            className={`h-1.5 flex-1 min-w-[20px] rounded-full transition-colors ${
              s.status === 'applied' ? 'bg-green-500' :
              s.status === 'skipped' ? 'bg-neutral-600' :
              i === currentIndex ? 'bg-blue-500' : 'bg-neutral-800'
            }`}
          />
        ))}
      </div>

      {currentStep && (
        <>
          <WizardStepCard
            step={currentStep}
            stepNumber={currentIndex + 1}
            totalSteps={steps.length}
            onRecover={handleRecovery}
            onSkip={skipStep}
          />
          {recoveryNotice && (
            <p role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
              {recoveryNotice}
            </p>
          )}
        </>
      )}
    </div>
  );
}
