import {
  firstTaskFlowReducer,
  initFirstTaskFlow,
  isStepRunnable,
  flowProgress,
  type FirstTaskFlowState,
} from "../firstTaskFlow";

function advanceToDone(state: FirstTaskFlowState): FirstTaskFlowState {
  let next = state;
  for (let i = 0; i < state.steps.length; i++) {
    next = firstTaskFlowReducer(next, { type: "start" });
    next = firstTaskFlowReducer(next, { type: "success" });
  }
  return next;
}

describe("firstTaskFlowReducer", () => {
  it("initialises three idle steps", () => {
    const state = initFirstTaskFlow();
    expect(state.steps).toHaveLength(3);
    expect(state.steps.every((s) => s.status === "idle")).toBe(true);
    expect(state.status).toBe("active");
    expect(state.currentIndex).toBe(0);
  });

  it("marks the current step running and counts attempts on start", () => {
    const state = firstTaskFlowReducer(initFirstTaskFlow(), { type: "start" });
    expect(state.steps[0].status).toBe("running");
    expect(state.steps[0].attempts).toBe(1);
  });

  it("advances to the next step on success", () => {
    let state = firstTaskFlowReducer(initFirstTaskFlow(), { type: "start" });
    state = firstTaskFlowReducer(state, { type: "success" });
    expect(state.steps[0].status).toBe("success");
    expect(state.currentIndex).toBe(1);
    expect(state.status).toBe("active");
  });

  it("completes the flow after the final step succeeds", () => {
    const state = advanceToDone(initFirstTaskFlow());
    expect(state.status).toBe("done");
    expect(flowProgress(state)).toBe(1);
  });

  it("records an error and allows a retry", () => {
    let state = firstTaskFlowReducer(initFirstTaskFlow(), { type: "start" });
    state = firstTaskFlowReducer(state, { type: "error", message: "rpc failed" });
    expect(state.steps[0].status).toBe("error");
    expect(state.steps[0].error).toBe("rpc failed");
    expect(isStepRunnable(state)).toBe(false);

    state = firstTaskFlowReducer(state, { type: "retry" });
    expect(state.steps[0].status).toBe("idle");
    expect(isStepRunnable(state)).toBe(true);
  });

  it("ignores retry unless the current step errored", () => {
    const state = initFirstTaskFlow();
    expect(firstTaskFlowReducer(state, { type: "retry" })).toBe(state);
  });

  it("skips the flow and then ignores further actions except reset", () => {
    let state = firstTaskFlowReducer(initFirstTaskFlow(), { type: "skip" });
    expect(state.status).toBe("skipped");

    const afterStart = firstTaskFlowReducer(state, { type: "start" });
    expect(afterStart).toBe(state);

    state = firstTaskFlowReducer(state, { type: "reset" });
    expect(state.status).toBe("active");
    expect(state.currentIndex).toBe(0);
  });

  it("reports progress as the fraction of completed steps", () => {
    let state = firstTaskFlowReducer(initFirstTaskFlow(), { type: "start" });
    state = firstTaskFlowReducer(state, { type: "success" });
    expect(flowProgress(state)).toBeCloseTo(1 / 3);
  });
});
