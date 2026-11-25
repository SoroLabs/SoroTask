import { useQuery, type UseQueryOptions, type QueryKey } from "@tanstack/react-query";
import { getSWRCache, type StaleWhileRevalidateCache } from "./StaleWhileRevalidateCache";

export interface SWRQueryOptions<TData, TError = Error>
  extends Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn"> {}

export interface SWRQueryResult<TData, TError = Error> {
  data: TData | undefined;
  isLoading: boolean;
  isError: boolean;
  error: TError | null;
  isStale: boolean;
  isFallback: boolean;
  attempt: number;
  refetch: () => void;
}

export function useSWRQuery<TData>(
  queryKey: QueryKey,
  fetchFn: (signal?: AbortSignal) => Promise<TData>,
  operation: string = "unknown",
  options?: SWRQueryOptions<TData>
): SWRQueryResult<TData> {
  const cache = getSWRCache();

  const queryResult = useQuery<TData>({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await cache.fetch(queryKey, fetchFn, operation, signal);
      return result.data;
    },
    staleTime: 0,
    ...options,
  });

  return {
    data: queryResult.data,
    isLoading: queryResult.isLoading,
    isError: queryResult.isError,
    error: queryResult.error,
    isStale: queryResult.isStale,
    isFallback: false,
    attempt: queryResult.failureCount + 1,
    refetch: queryResult.refetch as any,
  };
}

export function useSWRInfiniteQuery<TData, TPageParam = unknown>(
  queryKeyBase: QueryKey,
  fetchFn: (param: TPageParam, signal?: AbortSignal) => Promise<TData>,
  getNextParam: (lastPage: TData, allPages: TData[]) => TPageParam | undefined,
  operation: string = "unknown",
  options?: Omit<SWRQueryOptions<TData[]>, "queryKey" | "queryFn">
) {
  const cache = getSWRCache();

  return useQuery<TData[], Error>({
    queryKey: [...queryKeyBase, "infinite"] as QueryKey,
    queryFn: async ({ signal }) => {
      const result = await cache.fetch(queryKeyBase, async () => fetchFn(null as TPageParam, signal), operation, signal);
      return [result.data];
    },
    staleTime: 0,
    ...(options as SWRQueryOptions<TData[]>),
  });
}