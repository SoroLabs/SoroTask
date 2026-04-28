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
  getTask,
  listTasks,
  registerTask,
  updateTask,
  type RegisterTaskInput,
  type Task,
  type TaskFilters,
  type UpdateTaskInput,
} from "../lib/mockApi/tasks";
import { taskKeys } from "../lib/query/keys";

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
    { previous?: Task }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<Task, Error, UpdateTaskInput, { previous?: Task }>({
    mutationFn: updateTask,
    ...options,
    // Optimistic update: write the new value into the cache before the
    // server confirms, then roll back on error. Pattern: cancel any
    // in-flight refetch for the same key, snapshot the prior value into
    // the mutation's onMutate result, write the new value, return that
    // snapshot so onError can restore it.
    onMutate: async (input, context) => {
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
      return { previous };
    },
    onError: (err, input, onMutateResult, context) => {
      if (onMutateResult?.previous) {
        queryClient.setQueryData(
          taskKeys.detail(input.id),
          onMutateResult.previous,
        );
      }
      options?.onError?.(err, input, onMutateResult, context);
    },
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.setQueryData(taskKeys.detail(data.id), data);
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
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
