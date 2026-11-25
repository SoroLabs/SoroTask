export type FirstTaskStepId = "create-task" | "fund-wallet" | "deploy-target";

export type StepStatus = "idle" | "running" | "success" | "error";

export interface FirstTaskStep {
  id: FirstTaskStepId;
  title: string;
  status: StepStatus;
  attempts: number;
  error?: string;
}

export type FlowStatus = "active" | "done" | "skipped";

export interface FirstTaskFlowState {
  steps: FirstTaskStep[];
  currentIndex: number;
  status: FlowStatus;
}

export type FirstTaskFlowAction =
  | { type: "start" }
  | { type: "success" }
  | { type: "error"; message: string }
  | { type: "retry" }
  | { type: "skip" }
  | { type: "reset" };

const STEP_DEFS: { id: FirstTaskStepId; title: string }[] = [
  { id: "create-task", title: "Create your first task" },
  { id: "fund-wallet", title: "Fund your testnet wallet" },
  { id: "deploy-target", title: "Deploy a mock target" },
];

export function initFirstTaskFlow(): FirstTaskFlowState {
  return {
    steps: STEP_DEFS.map((def) => ({ ...def, status: "idle", attempts: 0 })),
    currentIndex: 0,
    status: "active",
  };
}

function patchCurrent(
  state: FirstTaskFlowState,
  patch: Partial<FirstTaskStep>,
): FirstTaskStep[] {
  return state.steps.map((step, index) =>
    index === state.currentIndex ? { ...step, ...patch } : step,
  );
}

export function firstTaskFlowReducer(
  state: FirstTaskFlowState,
  action: FirstTaskFlowAction,
): FirstTaskFlowState {
  if (state.status !== "active" && action.type !== "reset") {
    return state;
  }

  const current = state.steps[state.currentIndex];

  switch (action.type) {
    case "start":
      if (!current || current.status === "running" || current.status === "success") {
        return state;
      }
      return {
        ...state,
        steps: patchCurrent(state, {
          status: "running",
          attempts: current.attempts + 1,
          error: undefined,
        }),
      };

    case "success": {
      if (!current) return state;
      const steps = patchCurrent(state, { status: "success", error: undefined });
      const isLast = state.currentIndex >= state.steps.length - 1;
      return {
        ...state,
        steps,
        currentIndex: isLast ? state.currentIndex : state.currentIndex + 1,
        status: isLast ? "done" : "active",
      };
    }

    case "error":
      if (!current) return state;
      return {
        ...state,
        steps: patchCurrent(state, { status: "error", error: action.message }),
      };

    case "retry":
      if (!current || current.status !== "error") return state;
      return { ...state, steps: patchCurrent(state, { status: "idle", error: undefined }) };

    case "skip":
      return { ...state, status: "skipped" };

    case "reset":
      return initFirstTaskFlow();

    default:
      return state;
  }
}

export function isStepRunnable(state: FirstTaskFlowState): boolean {
  const current = state.steps[state.currentIndex];
  return state.status === "active" && current?.status === "idle";
}

export function flowProgress(state: FirstTaskFlowState): number {
  const completed = state.steps.filter((s) => s.status === "success").length;
  return completed / state.steps.length;
}
