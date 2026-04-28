import { QueryClient, type DefaultOptions } from "@tanstack/react-query";

// Default query/mutation options. Tuned for an on-chain app where:
// - Data does not change every second (5min staleTime is fine).
// - Most reads are cheap to refetch on window focus, so leave that on.
// - Most network errors *are* worth retrying once (transient RPC blips
//   are common), but giving up after 2 attempts keeps the UI responsive.
//   The contract-error spike's `mapContractError` handles user-facing
//   messaging — see the doc for how to wire it as a global onError.
export const DEFAULT_QUERY_OPTIONS: DefaultOptions = {
  queries: {
    staleTime: 5 * 60 * 1000,        // 5 min
    gcTime: 30 * 60 * 1000,          // 30 min
    retry: 2,
    retryDelay: (attempt) =>
      Math.min(1000 * Math.pow(2, attempt), 10_000),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  },
  mutations: {
    // Mutations should not auto-retry by default — the user clicked a
    // button, and silently retrying a write can produce duplicate side
    // effects. Callers that *want* retry (idempotent mutations) can
    // opt in per-call.
    retry: false,
  },
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: DEFAULT_QUERY_OPTIONS,
  });
}
