"use client";

import { useRouter } from "next/navigation";
import { PredictPrefetchDashboard } from "@/src/components/predictive-prefetch";

export default function PredictivePrefetchPage() {
  const router = useRouter();

  const prefetchFn = (route: string) => {
    router.prefetch(route);
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PredictPrefetchDashboard prefetchFn={prefetchFn} />
    </main>
  );
}
