'use client';

import React from 'react';
import type { WizardStep, ResolutionAction } from '../types';

interface WizardStepCardProps {
  step: WizardStep;
  stepNumber: number;
  totalSteps: number;
  onRecover: (action: ResolutionAction) => void;
  onSkip: () => void;
}

const CATEGORY_ICON: Record<string, string> = {
  INSUFFICIENT_GAS: '⛽',
  INSUFFICIENT_BALANCE: '💰',
  INSUFFICIENT_FEE: '💸',
  TOKEN_APPROVAL_REQUIRED: '✅',
  BAD_AUTH: '🔐',
  WALLET_LOCKED: '🔒',
  WALLET_REJECTED: '🚫',
  WALLET_NOT_INSTALLED: '🦊',
  WRONG_NETWORK: '🌐',
  INVALID_ARGS: '✏️',
  SIMULATION_FAILED: '🧪',
  CONTRACT_REVERT: '↩️',
  STATE_EXPIRED: '⏰',
  BAD_SEQUENCE: '🔄',
  NETWORK_ERROR: '📡',
  TIMEOUT: '⏱️',
  RATE_LIMITED: '🐢',
  SERVER_ERROR: '🖥️',
};

export function WizardStepCard({
  step,
  stepNumber,
  totalSteps,
  onRecover,
  onSkip,
}: WizardStepCardProps) {
  const icon = CATEGORY_ICON[step.category] ?? '🔧';
  // Use the first action's patch for the primary Apply button
  const primaryAction = step.actions[0];
  const primaryLabel =
    primaryAction?.type === 'reconnect_wallet' ||
    primaryAction?.type === 'top_up_balance' ||
    primaryAction?.type === 'switch_network' ||
    primaryAction?.type === 'approve_token'
      ? 'Open wallet'
      : primaryAction?.type === 'wait_and_retry'
        ? 'Show retry guidance'
        : primaryAction?.type === 'contact_support'
          ? 'Show support details'
          : 'Accept suggestion';

  return (
    <div
      data-testid={`wizard-step-${step.id}`}
      role="region"
      aria-label={`Step ${stepNumber} of ${totalSteps}: ${step.title}`}
      className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-4"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="text-2xl mt-0.5" aria-hidden="true">{icon}</span>
        <div>
          <p className="text-[11px] text-neutral-500 font-mono mb-0.5">
            {step.category} · step {stepNumber}/{totalSteps}
          </p>
          <h2 className="text-base font-semibold text-neutral-100">{step.title}</h2>
          <p className="text-sm text-neutral-400 mt-1 leading-relaxed">{step.explanation}</p>
          {step.diagnostic && (
            <details className="mt-3 rounded-lg border border-neutral-700 bg-neutral-950 p-3">
              <summary className="cursor-pointer text-xs font-medium text-neutral-200">
                Decoded {step.diagnostic.format} diagnostic
                {step.diagnostic.code ? ` · ${step.diagnostic.code}` : ''}
              </summary>
              <p className="mt-2 break-all font-mono text-xs text-neutral-300">
                {step.diagnostic.decodedText || 'No printable diagnostic text was found.'}
              </p>
            </details>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {step.actions.map((action) => (
          <div
            key={action.type}
            className="flex items-start gap-3 bg-neutral-800/60 rounded-lg px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-200">{action.label}</p>
              <p className="text-xs text-neutral-500 mt-0.5">{action.description}</p>
              {action.patch && (
                <p className="text-[11px] font-mono text-blue-400 mt-1">
                  {action.patch.field} → {action.patch.value}
                </p>
              )}
              {(action.type === 'reconnect_wallet' ||
                action.type === 'top_up_balance' ||
                action.type === 'switch_network' ||
                action.type === 'approve_token') && (
                <p className="mt-1 text-xs text-neutral-400">
                  Opens the wallet panel; verify all transaction details before signing. No approval is submitted automatically.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer buttons */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={() => primaryAction && onRecover(primaryAction)}
          aria-label={`${primaryLabel}: ${primaryAction?.label ?? step.title}`}
          className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip this step"
          className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 border border-neutral-700 hover:border-neutral-500 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
