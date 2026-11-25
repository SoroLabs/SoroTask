export interface SWRKeyParams {
  id?: string;
  filters?: Record<string, unknown>;
  cursor?: string;
  limit?: number;
}

export const swrKeys = {
  tasks: {
    all: ["tasks"] as const,
    lists: () => [...swrKeys.tasks.all, "list"] as const,
    list: (params: SWRKeyParams = {}) => [...swrKeys.tasks.lists(), params] as const,
    details: () => [...swrKeys.tasks.all, "detail"] as const,
    detail: (id: string) => [...swrKeys.tasks.details(), id] as const,
  },
  executions: {
    all: ["executions"] as const,
    lists: () => [...swrKeys.executions.all, "list"] as const,
    list: (params: SWRKeyParams = {}) => [...swrKeys.executions.lists(), params] as const,
    details: () => [...swrKeys.executions.all, "detail"] as const,
    detail: (id: string) => [...swrKeys.executions.details(), id] as const,
  },
  keeper: {
    all: ["keeper"] as const,
    state: () => [...swrKeys.keeper.all, "state"] as const,
    stats: () => [...swrKeys.keeper.all, "stats"] as const,
  },
} as const;