import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useOptimisticTaskExecution } from "../useOptimisticTaskExecution";
import { taskKeys } from "../../lib/query/keys";
import type { Task } from "../../lib/api/tasks";
import type { TaskChainEvent } from "../../types/sorobanEvents";

jest.mock("sonner", () => ({
  toast: {
    loading: jest.fn().mockReturnValue("toast-id"),
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const executeTaskMock = jest.fn();
jest.mock("../../lib/api/tasks", () => ({
  ...jest.requireActual("../../lib/api/tasks"),
  executeTask: (...args: unknown[]) => executeTaskMock(...args),
}));

let capturedOnEvent: ((event: TaskChainEvent) => void) | null = null;
jest.mock("../useSorobanTaskEvents", () => ({
  useSorobanTaskEvents: (
    _taskId: string | undefined,
    _contractId: string | undefined,
    onEvent: (event: TaskChainEvent) => void,
  ) => {
    capturedOnEvent = onEvent;
  },
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const task: Task = {
    id: "task-1",
    contract: "CTARGET",
    fn: "ping",
    intervalSec: 60,
    gas: 10,
    status: "success",
    updatedAt: Date.now(),
  };
  queryClient.setQueryData(taskKeys.detail("task-1"), task);
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedOnEvent = null;
});

describe("useOptimisticTaskExecution", () => {
  it("optimistically flips status to running, then confirms on a successful execution", async () => {
    executeTaskMock.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ id: "task-1", status: "success", txHash: "tx-1" }), 200),
        ),
    );
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useOptimisticTaskExecution("task-1", { contractId: "CREG", userAddress: "GADDR" }),
      { wrapper },
    );

    let resolveDone: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    act(() => {
      void result.current.execute().finally(() => resolveDone?.());
    });

    await waitFor(() => {
      expect(queryClient.getQueryData<Task>(taskKeys.detail("task-1"))?.status).toBe("running");
    });

    await act(async () => {
      await done;
    });

    expect(toast.success).toHaveBeenCalled();
    expect(queryClient.getQueryData<Task>(taskKeys.detail("task-1"))?.status).toBe("success");
  });

  it("rolls back to the previous status and shows a failure toast when the call throws", async () => {
    executeTaskMock.mockRejectedValue(new Error("simulation failed"));
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useOptimisticTaskExecution("task-1", { contractId: "CREG", userAddress: "GADDR" }),
      { wrapper },
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(toast.error).toHaveBeenCalled();
    expect(queryClient.getQueryData<Task>(taskKeys.detail("task-1"))?.status).toBe("success");
  });

  it("reconciles a later on-chain revert event to a failed status with a toast", async () => {
    executeTaskMock.mockResolvedValue({ id: "task-1", status: "running", txHash: "tx-2" });
    const { queryClient, wrapper } = makeWrapper();

    renderHook(
      () => useOptimisticTaskExecution("task-1", { contractId: "CREG", userAddress: "GADDR" }),
      { wrapper },
    );

    await waitFor(() => expect(capturedOnEvent).not.toBeNull());

    act(() => {
      capturedOnEvent!({
        taskId: "task-1",
        eventType: "task_executed",
        txHash: "tx-3",
        ledger: 10,
        ledgerClosedAt: "2026-01-01T00:00:00Z",
        inSuccessfulContractCall: false,
        observedAt: Date.now(),
      });
    });

    expect(queryClient.getQueryData<Task>(taskKeys.detail("task-1"))?.status).toBe("failed");
    expect(toast.error).toHaveBeenCalled();
  });

  it("does not corrupt the current task's cache when handling an event for a different task", async () => {
    const { queryClient, wrapper } = makeWrapper();
    renderHook(
      () => useOptimisticTaskExecution("task-1", { contractId: "CREG", userAddress: "GADDR" }),
      { wrapper },
    );

    await waitFor(() => expect(capturedOnEvent).not.toBeNull());

    act(() => {
      capturedOnEvent!({
        taskId: "task-999",
        eventType: "task_executed",
        txHash: "tx-4",
        ledger: 10,
        ledgerClosedAt: "2026-01-01T00:00:00Z",
        inSuccessfulContractCall: true,
        observedAt: Date.now(),
      });
    });

    expect(queryClient.getQueryData<Task>(taskKeys.detail("task-1"))?.status).toBe("success");
  });
});
