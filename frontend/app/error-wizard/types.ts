/**
 * Types for the Automated Task Error Resolution Wizard (#409)
 * Builds on the existing ContractErrorCategory taxonomy in
 * src/lib/errors/contractErrors.ts
 */

import type {
  ContractErrorCategory,
  DecodedContractDiagnostic,
} from '@/src/lib/errors/contractErrors';

// ---------------------------------------------------------------------------
// Failure log — what comes from the backend / keeper logs
// ---------------------------------------------------------------------------

export interface FailureLog {
  taskId: string;
  timestamp: string; // ISO
  errorCode: string; // Raw keeper error code, e.g. "TX_BAD_SEQ"
  errorMessage: string;
  diagnosticPayload?: unknown;
  /** Optional structured fields from the keeper execution context */
  context?: {
    contractAddress?: string;
    functionName?: string;
    gasUsed?: number;
    gasBudget?: number;
    tokenAddress?: string;
    spenderAddress?: string;
    attempt?: number;
    maxAttempts?: number;
  };
}

// ---------------------------------------------------------------------------
// Resolution step
// ---------------------------------------------------------------------------

export type StepStatus = 'pending' | 'applied' | 'skipped';

export type ResolutionActionType =
  | 'increase_gas'
  | 'fix_contract_address'
  | 'fix_function_name'
  | 'fix_interval'
  | 'reconnect_wallet'
  | 'switch_network'
  | 'top_up_balance'
  | 'approve_token'
  | 'wait_and_retry'
  | 'contact_support';

export interface ResolutionAction {
  type: ResolutionActionType;
  label: string;
  description: string;
  /** Suggested field + value to apply. Null for informational-only actions. */
  patch?: { field: string; value: string | number };
}

export interface WizardStep {
  id: string;
  /** Maps 1:1 to ContractErrorCategory so existing copy/action can be reused */
  category: ContractErrorCategory;
  title: string;
  explanation: string;
  diagnostic?: DecodedContractDiagnostic;
  /** Ordered list of fix actions for this step */
  actions: ResolutionAction[];
  status: StepStatus;
}

// ---------------------------------------------------------------------------
// Wizard state
// ---------------------------------------------------------------------------

export type WizardPhase = 'idle' | 'analyzing' | 'ready' | 'complete';

export interface WizardState {
  phase: WizardPhase;
  steps: WizardStep[];
  currentIndex: number;
  /** Patches the user has confirmed, keyed by field name */
  appliedPatches: Record<string, string | number>;
  error: string | null;
}
