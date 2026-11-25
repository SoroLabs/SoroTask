import { renderHook, act, waitFor } from "@testing-library/react";
import { useFirstTaskOnboarding } from "../useFirstTaskOnboarding";
import { type FirstTaskStepId } from "../firstTaskFlow";

describe("useFirstTaskOnboarding", () => {
  it("runs every step in order until the flow is done", async () => {
    const calls: FirstTaskStepId[] = [];
    const runStep = jest.fn(async (id: FirstTaskStepId) => {
      calls.push(id);
    });

    const { result } = renderHook(() => useFirstTaskOnboarding(runStep));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(calls).toEqual(["create-task", "fund-wallet", "deploy-target"]);
    expect(result.current.state.steps.every((s) => s.status === "success")).toBe(true);
  });

  it("stops on a failing step and resumes after retry", async () => {
    const runStep = jest
      .fn()
      .mockResolvedValueOnce(undefined) // create-task
      .mockRejectedValueOnce(new Error("friendbot down")) // fund-wallet fails
      .mockResolvedValue(undefined); // retry + rest

    const { result } = renderHook(() => useFirstTaskOnboarding(runStep));

    await waitFor(() => expect(result.current.state.steps[1].status).toBe("error"));
    expect(result.current.state.steps[1].error).toBe("friendbot down");
    expect(result.current.state.status).toBe("active");

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.state.steps[1].attempts).toBe(2);
  });

  it("skips the flow on demand", async () => {
    const runStep = jest.fn(async () => {
      throw new Error("should not matter");
    });
    const { result } = renderHook(() => useFirstTaskOnboarding(runStep));

    act(() => result.current.skip());
    await waitFor(() => expect(result.current.state.status).toBe("skipped"));
  });
});
