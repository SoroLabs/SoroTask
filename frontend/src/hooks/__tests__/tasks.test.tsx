import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useDeleteTask,
  useRegisterTask,
  useTask,
  useTasks,
  useUpdateTask,
} from "../tasks";
import {
  __resetMockApi,
  __setMockApi,
} from "../../lib/mockApi/tasks";
import { taskKeys } from "../../lib/query/keys";

function makeWrapper(client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  __resetMockApi();
  __setMockApi({ latencyMs: 0, failureRate: 0 });
});

describe("useTasks", () => {
  it("returns the list of seeded tasks", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTasks(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
  });

  it("scopes the cache by filters", async () => {
    const { wrapper, queryClient } = makeWrapper();
    renderHook(() => useTasks({ status: "pending" }), { wrapper });
    renderHook(() => useTasks({ status: "failed" }), { wrapper });
    await waitFor(() => {
      const pending = queryClient.getQueryData(
        taskKeys.list({ status: "pending" }),
      );
      const failed = queryClient.getQueryData(
        taskKeys.list({ status: "failed" }),
      );
      expect(pending).toBeDefined();
      expect(failed).toBeDefined();
    });
    const pending = queryClient.getQueryData(
      taskKeys.list({ status: "pending" }),
    );
    const failed = queryClient.getQueryData(
      taskKeys.list({ status: "failed" }),
    );
    expect(pending).not.toBe(failed);
  });

  it("surfaces errors when the API fails", async () => {
    const { wrapper } = makeWrapper();
    __setMockApi({ failureRate: 1 });
    const { result } = renderHook(() => useTasks(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("Mock RPC");
  });
});

describe("useTask", () => {
  it("is disabled when id is undefined", () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTask(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("loads a single task by id", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTask("task-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("task-1");
  });
});

describe("useRegisterTask", () => {
  it("invalidates the list cache after success", async () => {
    const { wrapper, queryClient } = makeWrapper();
    // Seed the lists cache by reading it.
    const { result: list } = renderHook(() => useTasks(), { wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    const initialCount = list.current.data?.length ?? 0;

    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const { result: register } = renderHook(() => useRegisterTask(), {
      wrapper,
    });
    await act(async () => {
      await register.current.mutateAsync({
        contract: "CNEW",
        fn: "ping",
        intervalSec: 60,
        gas: 1,
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: taskKeys.lists() }),
    );
    await waitFor(() =>
      expect((list.current.data ?? []).length).toBe(initialCount + 1),
    );
  });

  it("seeds the detail cache with the new task", async () => {
    const { wrapper, queryClient } = makeWrapper();
    const { result } = renderHook(() => useRegisterTask(), { wrapper });
    let createdId = "";
    await act(async () => {
      const created = await result.current.mutateAsync({
        contract: "CSEED",
        fn: "ping",
        intervalSec: 60,
        gas: 1,
      });
      createdId = created.id;
    });
    expect(queryClient.getQueryData(taskKeys.detail(createdId))).toBeDefined();
  });
});

describe("useUpdateTask", () => {
  it("optimistically updates the detail cache and confirms on success", async () => {
    const { wrapper, queryClient } = makeWrapper();
    // Slow the API so we can observe the optimistic value.
    __setMockApi({ latencyMs: 100, failureRate: 0 });

    const { result: detail } = renderHook(() => useTask("task-1"), { wrapper });
    await waitFor(() => expect(detail.current.isSuccess).toBe(true));

    const { result: update } = renderHook(() => useUpdateTask(), { wrapper });
    let resolvePromise: (() => void) | null = null;
    const finished = new Promise<void>((r) => {
      resolvePromise = r;
    });

    act(() => {
      update.current
        .mutateAsync({ id: "task-1", intervalSec: 9999 })
        .finally(() => resolvePromise?.());
    });

    // Optimistic value should appear before the mutation resolves.
    await waitFor(() => {
      const cached = queryClient.getQueryData<{ intervalSec: number }>(
        taskKeys.detail("task-1"),
      );
      expect(cached?.intervalSec).toBe(9999);
    });

    await act(async () => {
      await finished;
    });

    expect(
      (queryClient.getQueryData<{ intervalSec: number }>(
        taskKeys.detail("task-1"),
      ))?.intervalSec,
    ).toBe(9999);
  });

  it("rolls the cache back when the mutation fails", async () => {
    const { wrapper, queryClient } = makeWrapper();
    const { result: detail } = renderHook(() => useTask("task-1"), { wrapper });
    await waitFor(() => expect(detail.current.isSuccess).toBe(true));
    const before = queryClient.getQueryData<{ intervalSec: number }>(
      taskKeys.detail("task-1"),
    )?.intervalSec;

    __setMockApi({ failureRate: 1 });
    const { result: update } = renderHook(() => useUpdateTask(), { wrapper });
    await act(async () => {
      try {
        await update.current.mutateAsync({ id: "task-1", intervalSec: 1 });
      } catch {
        // expected
      }
    });

    const after = queryClient.getQueryData<{ intervalSec: number }>(
      taskKeys.detail("task-1"),
    )?.intervalSec;
    expect(after).toBe(before);
  });
});

describe("useDeleteTask", () => {
  it("removes the detail cache and invalidates lists", async () => {
    const { wrapper, queryClient } = makeWrapper();
    const { result: detail } = renderHook(() => useTask("task-1"), { wrapper });
    await waitFor(() => expect(detail.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(taskKeys.detail("task-1"))).toBeDefined();

    const removeSpy = jest.spyOn(queryClient, "removeQueries");
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const { result: del } = renderHook(() => useDeleteTask(), { wrapper });
    await act(async () => {
      await del.current.mutateAsync("task-1");
    });

    expect(removeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: taskKeys.detail("task-1") }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: taskKeys.lists() }),
    );
  });
});
