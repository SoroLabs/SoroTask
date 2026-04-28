import type { ReactNode } from "react";
import { QueryProvider } from "../../src/lib/query/QueryProvider";

// Wrapping at the route layout (not the root layout) keeps the provider
// scoped to pages that use it. When the rest of the app starts using
// queries, lift this up to app/layout.tsx.
export default function QueryDemoLayout({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
