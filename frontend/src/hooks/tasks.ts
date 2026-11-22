"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import {
  deleteTask,
  executeTask,
  getTask,
  listTasks,
  registerTask,
  updateTask,
  pauseTask,
  resumeTask,
  cancelTask,
  pauseTasksBulk,
  resumeTasksBulk,
  cancelTasksBulk,
  refillTasksBulk,
  type BatchTaskResult,
  type RegisterTaskInput,
  type Task,
  type TaskFilters,
  type TaskStatus,
  type UpdateTaskInput,
} from "../lib/api/tasks";
import { taskKeys } from "../lib/query/keys";
import { createPerformanceMonitor } from "../lib/frontend-performance";

const monitor = createPerformanceMonitor({ route: "/tasks" });

// Read hooks ----------------------------------------------------------
//
// Convention: each query hook accepts an `options` parameter that maps
// straight onto TanStack Query's options bag (with the keys + queryFn
// already filled in). This lets callers override staleTime/enabled/etc
// per-call without us having to add bespoke parameters.

type ListOptions = Omit<
  UseQueryOptions<Task[]>,
  "queryKey" | "queryFn"
>;

export function useTasks(filters: TaskFilters = {}, options?: ListOptions) {
  return useQuery<Task[]>({
    queryKey: taskKeys.list(filters),
    queryFn: () => listTasks(filters),
    ...options,
  });
}

type DetailOptions = Omit<UseQueryOptions<Task>, "queryKey" | "queryFn">;

export function useTask(id: string | undefined, options?: DetailOptions) {
  return useQuery<Task>({
    queryKey: taskKeys.detail(id ?? "__none__"),
    queryFn: () => getTask(id as string),
    enabled: Boolean(id) && (options?.enabled ?? true),
    ...options,
  });
}

// Write hooks ---------------------------------------------------------
//
// Convention: each mutation hook owns its invalidation rules. Callers
// should not invalidate cache from component code — a hook's contract
// is "after this resolves, the affected queries are fresh."
//
// All three of these hooks invalidate `taskKeys.lists()` (every list
// view) but only invalidate the specific `taskKeys.detail(id)` they
// touched. This is why the key factory has the tiered structure.

// TanStack Query v5 lifecycle signature:
//   onMutate(variables, context) -> TOnMutateResult
//   onSuccess(data, variables, onMutateResult, context)
//   onError(error, variables, onMutateResult, context)
// The fourth generic on useMutation is the type of `onMutateResult`.

export function useRegisterTask(
  options?: UseMutationOptions<Task, Error, RegisterTaskInput>,
) {
  const queryClient = useQueryClient();
  return useMutation<Task, Error, RegisterTaskInput>({
    mutationFn: registerTask,
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      // Seed the detail cache so a navigation to /tasks/:id is instant.
      queryClient.setQueryData(taskKeys.detail(data.id), data);
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateTask(
  options?: UseMutationOptions<
    Task,
    Error,
    UpdateTaskInput,
    { previous?: Task; finishPerf?: ReturnType<typeof monitor.start> }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<Task, Error, UpdateTaskInput, { previous?: Task; finishPerf?: ReturnType<typeof monitor.start> }>({
    mutationFn: updateTask,
    ...options,
    // Optimistic update: write the new value into the cache before the
    // server confirms, then roll back on error. Pattern: cancel any
    // in-flight refetch for the same key, snapshot the prior value into
    // the mutation's onMutate result, write the new value, return that
    // snapshot so onError can restore it.
    onMutate: async (input, context) => {
      const finishPerf = monitor.start("task_mutation");
      await queryClient.cancelQueries({
        queryKey: taskKeys.detail(input.id),
      });
      const previous = queryClient.getQueryData<Task>(
        taskKeys.detail(input.id),
      );
      if (previous) {
        queryClient.setQueryData<Task>(taskKeys.detail(input.id), {
          ...previous,
          ...input,
          updatedAt: Date.now(),
        });
      }
      void options?.onMutate?.(input, context);
      return { previous, finishPerf };
    },
    onError: (err, input, onMutateResult, context) => {
      if (onMutateResult?.previous) {
        queryClient.setQueryData(
          taskKeys.detail(input.id),
          onMutateResult.previous,
        );
      }
      onMutateResult?.finishPerf?.();
      options?.onError?.(err, input, onMutateResult, context);
    },
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.setQueryData(taskKeys.detail(data.id), data);
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      onMutateResult?.finishPerf?.();
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useDeleteTask(
  options?: UseMutationOptions<{ id: string }, Error, string>,
) {
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: deleteTask,
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.removeQueries({ queryKey: taskKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// Lifecycle mutations

interface TaskLifecycleInput {
  taskId: string;
  userAddress?: string;
  contractId?: string;
}

export function usePauseTask(
  options?: UseMutationOptions<{ id: string; status: TaskStatus }, Error, TaskLifecycleInput>,
) {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; status: TaskStatus }, Error, TaskLifecycleInput>({
    mutationFn: ({ taskId, userAddress, contractId }) => pauseTask(taskId, userAddress, contractId),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.setQueryData<Task>(taskKeys.detail(data.id), (old) => 
        old ? { ...old, status: data.status } : old
      );
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useResumeTask(
  options?: UseMutationOptions<{ id: string; status: TaskStatus }, Error, TaskLifecycleInput>,
) {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; status: TaskStatus }, Error, TaskLifecycleInput>({
    mutationFn: ({ taskId, userAddress, contractId }) => resumeTask(taskId, userAddress, contractId),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.setQueryData<Task>(taskKeys.detail(data.id), (old) => 
        old ? { ...old, status: data.status } : old
      );
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useCancelTask(
  options?: UseMutationOptions<{ id: string }, Error, TaskLifecycleInput>,
) {
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, Error, TaskLifecycleInput>({
    mutationFn: ({ taskId, userAddress, contractId }) => cancelTask(taskId, userAddress, contractId),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.removeQueries({ queryKey: taskKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// Manual execution trigger, with optimistic status + rollback ------------
//
// Unlike pause/resume/cancel, this mutation flips the cache to "running"
// in `onMutate` — before the wallet even signs — so the UI reflects the
// user's action immediately. If the on-chain call throws (rejected
// signature, simulation failure, or a revert surfaced by
// `executeContractCall`'s confirmation poll), `onError` restores the
// pre-mutation snapshot. Callers that also want a toast on that rollback
// path should pass `onError` through `options`.

export interface ExecuteTaskResult {
  id: string;
  status: TaskStatus;
  txHash?: string;
}

export function useExecuteTask(
  options?: UseMutationOptions<
    ExecuteTaskResult,
    Error,
    TaskLifecycleInput,
    { previous?: Task }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<ExecuteTaskResult, Error, TaskLifecycleInput, { previous?: Task }>({
    mutationFn: ({ taskId, userAddress, contractId }) =>
      executeTask(taskId, userAddress, contractId),
    ...options,
    onMutate: async (input, context) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(input.taskId) });
      const previous = queryClient.getQueryData<Task>(taskKeys.detail(input.taskId));
      if (previous) {
        queryClient.setQueryData<Task>(taskKeys.detail(input.taskId), {
          ...previous,
          status: "running",
          updatedAt: Date.now(),
        });
      }
      void options?.onMutate?.(input, context);
      return { previous };
    },
    onError: (err, input, onMutateResult, context) => {
      if (onMutateResult?.previous) {
        queryClient.setQueryData(taskKeys.detail(input.taskId), onMutateResult.previous);
      }
      options?.onError?.(err, input, onMutateResult, context);
    },
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.setQueryData<Task>(taskKeys.detail(data.id), (old) =>
        old ? { ...old, status: data.status } : old,
      );
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

// Batch lifecycle mutations ------------------------------------------------
//
// These assemble ONE atomic multi-operation Soroban transaction across all
// selected tasks, so the whole action needs a single wallet signature
// (see frontend/app/tasks/bulk/).

interface BatchLifecycleInput {
  taskIds: string[];
  userAddress?: string;
  contractId?: string;
}

interface BatchRefillInput extends BatchLifecycleInput {
  amount: string | bigint;
}

function invalidateBatch(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
  void queryClient.invalidateQueries({ queryKey: taskKeys.all });
}

export function useBatchPauseTasks(
  options?: UseMutationOptions<BatchTaskResult[], Error, BatchLifecycleInput>,
) {
  const queryClient = useQueryClient();
  return useMutation<BatchTaskResult[], Error, BatchLifecycleInput>({
    mutationFn: ({ taskIds, userAddress, contractId }) =>
      pauseTasksBulk(taskIds, userAddress, contractId),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      invalidateBatch(queryClient);
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useBatchResumeTasks(
  options?: UseMutationOptions<BatchTaskResult[], Error, BatchLifecycleInput>,
) {
  const queryClient = useQueryClient();
  return useMutation<BatchTaskResult[], Error, BatchLifecycleInput>({
    mutationFn: ({ taskIds, userAddress, contractId }) =>
      resumeTasksBulk(taskIds, userAddress, contractId),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      invalidateBatch(queryClient);
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useBatchCancelTasks(
  options?: UseMutationOptions<BatchTaskResult[], Error, BatchLifecycleInput>,
) {
  const queryClient = useQueryClient();
  return useMutation<BatchTaskResult[], Error, BatchLifecycleInput>({
    mutationFn: ({ taskIds, userAddress, contractId }) =>
      cancelTasksBulk(taskIds, userAddress, contractId),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      invalidateBatch(queryClient);
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useBatchRefillTasks(
  options?: UseMutationOptions<BatchTaskResult[], Error, BatchRefillInput>,
) {
  const queryClient = useQueryClient();
  return useMutation<BatchTaskResult[], Error, BatchRefillInput>({
    mutationFn: ({ taskIds, amount, userAddress, contractId }) =>
      refillTasksBulk(taskIds, amount, userAddress, contractId),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      invalidateBatch(queryClient);
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// Cache invalidation helpers for on-chain confirmation -------------------

export async function invalidateTaskCache(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId?: string,
  userAddress?: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    taskId
      ? queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
      : Promise.resolve(),
    userAddress
      ? queryClient.invalidateQueries({ queryKey: ["tasks", userAddress] })
      : Promise.resolve(),
    taskId
      ? queryClient.invalidateQueries({ queryKey: ["task", taskId] })
      : Promise.resolve(),
  ]);
}

export function useInvalidateTaskOnConfirmation() {
  const queryClient = useQueryClient();
  return (taskId?: string, userAddress?: string) =>
    invalidateTaskCache(queryClient, taskId, userAddress);
}

