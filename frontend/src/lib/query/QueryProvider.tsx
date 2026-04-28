"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { createQueryClient } from "./queryClient";

export interface QueryProviderProps {
  children: React.ReactNode;
  // When true, the React Query Devtools panel mounts. Defaults to
  // `process.env.NODE_ENV !== "production"`.
  devtools?: boolean;
}

export function QueryProvider({ children, devtools }: QueryProviderProps) {
  // One QueryClient per tab. useState's lazy init guarantees a single
  // instance even across StrictMode double-renders. A module-level
  // singleton would break SSR (clients across requests would share
  // cache).
  const [client] = useState(() => createQueryClient());

  const showDevtools =
    devtools ?? process.env.NODE_ENV !== "production";

  return (
    <QueryClientProvider client={client}>
      {children}
      {showDevtools && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
