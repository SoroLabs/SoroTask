'use client';

import { useReducer, useCallback } from 'react';
import { mapContractError, decodeSorobanContractError } from '@/src/lib/errors/contractErrors';
import type { FailureLog, WizardStep, WizardState, ResolutionAction } from './types';

let stepCounter = 0;

export function generateSteps(logs: FailureLog[]): WizardStep[] {
  const seen = new Set<string>();
  const steps: WizardStep[] = [];

  for (const log of logs) {
    // 1. Try decoding raw Soroban contract error stream / discriminant
    const diagnostic = decodeSorobanContractError(log.errorMessage) || decodeSorobanContractError(log.errorCode);
    
    // 2. Fall back to mapped contract error category
    const mapped = mapContractError({
      message: log.errorMessage,
      code: log.errorCode,
    });

    const stepKey = diagnostic ? `contract-${diagnostic.code}` : mapped.category;
    if (seen.has(stepKey)) continue;
    seen.add(stepKey);

    const actions = diagnostic
      ? buildDiagnosticActions(diagnostic)
      : buildActions(mapped.category, log);

    if (actions.length === 0) continue;

    steps.push({
      id: `step-${++stepCounter}`,
      category: mapped.category,
      title: diagnostic ? diagnostic.title : mapped.title,
      explanation: diagnostic
        ? `${diagnostic.explanation} ${diagnostic.fixSuggestion}`
        : mapped.userMessage,
      actions,
      status: 'pending',
    });
  }

  return steps;
}

function buildDiagnosticActions(diagnostic: ReturnType<typeof decodeSorobanContractError> & object): ResolutionAction[] {
  switch (diagnostic.action) {
    case 'increase_gas':
      return [
        {
          type: 'increase_gas',
          label: 'Increase gas escrow (+50 XLM)',
          description: diagnostic.fixSuggestion,
          patch: { field: 'gasBalance', value: 50 },
        },
      ];
    case 'reconnect_wallet':
      return [
        {
          type: 'reconnect_wallet',
          label: 'Reconnect Authorized Wallet',
          description: diagnostic.fixSuggestion,
        },
      ];
    case 'switch_network':
      return [
        {
          type: 'switch_network',
          label: 'Switch Network',
          description: diagnostic.fixSuggestion,
        },
      ];
    case 'wait':
      return [
        {
          type: 'wait_and_retry',
          label: 'Wait & Retry Execution',
          description: diagnostic.fixSuggestion,
        },
      ];
    case 'retry':
      return [
        {
          type: 'wait_and_retry',
          label: 'Retry Execution',
          description: diagnostic.fixSuggestion,
        },
      ];
    case 'fix_input':
    default:
      return [
        {
          type: 'fix_contract_address',
          label: 'Apply Remediation Fix',
          description: diagnostic.fixSuggestion,
          patch: { field: 'remediation', value: diagnostic.name },
        },
      ];
  }
}

function buildActions(
  category: ReturnType<typeof mapContractError>['category'],
  log: FailureLog,
): ResolutionAction[] {
  const ctx = log.context ?? {};

  switch (category) {
    case 'INSUFFICIENT_GAS': {
      const suggested = ctx.gasBudget ? Math.ceil(ctx.gasBudget * 1.5) : 100000;
      return [{
        type: 'increase_gas',
        label: 'Increase gas budget',
        description: `Set gas budget to ${suggested} (1.5× current).`,
        patch: { field: 'gasBalance', value: suggested },
      }];
    }
    case 'INSUFFICIENT_BALANCE':
      return [{
        type: 'top_up_balance',
        label: 'Top up account balance',
        description: 'Add XLM to your account before the next execution.',
      }];
    case 'INSUFFICIENT_FEE':
      return [{
        type: 'increase_gas',
        label: 'Raise transaction fee',
        description: 'The fee was below the network minimum. Increase gas balance.',
        patch: { field: 'gasBalance', value: 10 },
      }];
    case 'BAD_AUTH':
    case 'WALLET_LOCKED':
    case 'WALLET_REJECTED':
      return [{
        type: 'reconnect_wallet',
        label: 'Reconnect wallet',
        description: 'Disconnect and reconnect Freighter, then try again.',
      }];
    case 'WALLET_NOT_INSTALLED':
      return [{
        type: 'reconnect_wallet',
        label: 'Install Freighter',
        description: 'Install the Freighter browser extension to sign transactions.',
      }];
    case 'WRONG_NETWORK':
      return [{
        type: 'switch_network',
        label: 'Switch Network',
        description: 'Open Freighter and switch the network to active chain.',
      }];
    case 'INVALID_ARGS':
    case 'SIMULATION_FAILED':
    case 'CONTRACT_REVERT': {
      const actions: ResolutionAction[] = [];
      if (ctx.contractAddress) {
        actions.push({
          type: 'fix_contract_address',
          label: 'Verify contract address',
          description: `Confirm that "${ctx.contractAddress}" is the correct contract.`,
          patch: { field: 'contractAddress', value: ctx.contractAddress },
        });
      }
      if (ctx.functionName) {
        actions.push({
          type: 'fix_function_name',
          label: 'Verify function name',
          description: `Confirm "${ctx.functionName}" is exported by the contract.`,
          patch: { field: 'functionName', value: ctx.functionName },
        });
      }
      if (actions.length === 0) {
        actions.push({
          type: 'fix_contract_address',
          label: 'Review contract inputs',
          description: 'Check the contract address and function name for typos.',
        });
      }
      return actions;
    }
    case 'BAD_SEQUENCE':
    case 'TX_TOO_LATE':
    case 'TX_TOO_EARLY':
    case 'DUPLICATE_TRANSACTION':
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
    case 'RATE_LIMITED':
    case 'SERVER_ERROR':
      return [{
        type: 'wait_and_retry',
        label: 'Wait and retry',
        description: 'This error is transient. The keeper will retry automatically.',
      }];
    case 'STATE_EXPIRED':
      return [{
        type: 'fix_interval',
        label: 'Reduce execution interval',
        description: 'Schedule tasks more frequently to prevent storage expiry.',
        patch: { field: 'interval', value: 86400 },
      }];
    default:
      return [{
        type: 'contact_support',
        label: 'Contact support',
        description: 'This error requires manual investigation. Share the error code with support.',
      }];
  }
}

type Action =
  | { type: 'ANALYZE'; logs: FailureLog[] }
  | { type: 'ANALYZE_DONE'; steps: WizardStep[] }
  | { type: 'ANALYZE_ERROR'; error: string }
  | { type: 'APPLY_STEP'; patch?: { field: string; value: string | number } }
  | { type: 'SKIP_STEP' }
  | { type: 'RESET' };

const initial: WizardState = {
  phase: 'idle',
  steps: [],
  currentIndex: 0,
  appliedPatches: {},
  error: null,
};

function advance(state: WizardState): WizardState {
  const next = state.currentIndex + 1;
  return {
    ...state,
    currentIndex: next,
    phase: next >= state.steps.length ? 'complete' : 'ready',
  };
}

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'ANALYZE':
      return { ...initial, phase: 'analyzing' };
    case 'ANALYZE_DONE':
      return {
        ...state,
        phase: action.steps.length ? 'ready' : 'complete',
        steps: action.steps,
        currentIndex: 0,
      };
    case 'ANALYZE_ERROR':
      return { ...state, phase: 'idle', error: action.error };
    case 'APPLY_STEP': {
      const steps = state.steps.map((s, i) =>
        i === state.currentIndex ? { ...s, status: 'applied' as const } : s,
      );
      const patches = action.patch
        ? { ...state.appliedPatches, [action.patch.field]: action.patch.value }
        : state.appliedPatches;
      return advance({ ...state, steps, appliedPatches: patches });
    }
    case 'SKIP_STEP': {
      const steps = state.steps.map((s, i) =>
        i === state.currentIndex ? { ...s, status: 'skipped' as const } : s,
      );
      return advance({ ...state, steps });
    }
    case 'RESET':
      return initial;
    default:
      return state;
  }
}

export function useErrorWizard() {
  const [state, dispatch] = useReducer(reducer, initial);

  const analyze = useCallback((logs: FailureLog[]) => {
    dispatch({ type: 'ANALYZE', logs });
    try {
      const steps = generateSteps(logs);
      dispatch({ type: 'ANALYZE_DONE', steps });
    } catch (err) {
      dispatch({
        type: 'ANALYZE_ERROR',
        error: err instanceof Error ? err.message : 'Analysis failed',
      });
    }
  }, []);

  const applyStep = useCallback((patch?: { field: string; value: string | number }) => {
    dispatch({ type: 'APPLY_STEP', patch });
  }, []);

  const skipStep = useCallback(() => {
    dispatch({ type: 'SKIP_STEP' });
  }, []);

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  const currentStep = state.steps[state.currentIndex] ?? null;

  return {
    phase: state.phase,
    steps: state.steps,
    currentStep,
    currentIndex: state.currentIndex,
    appliedPatches: state.appliedPatches,
    error: state.error,
    analyze,
    applyStep,
    skipStep,
    reset,
  };
}
