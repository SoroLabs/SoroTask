import React, { Suspense } from "react";
import { DashboardClient } from "./DashboardClient";
import { StatCardSkeleton, ChartSkeleton, TableSkeleton } from "@/components/skeletons";
import { getDashboardServerData } from "@/src/lib/rsc/server-data";
import { DashboardWidgetGrid } from "./DashboardWidgetGrid";
import { DashboardPortfolioAllocation } from "@/src/components/DashboardPortfolioAllocation";
import { PrivacyMaskToggle } from "@/src/components/PrivacyMaskToggle";


async function DashboardContent() {
  const data = await getDashboardServerData();

  return (
    <>
      <header
        data-onboarding="dashboard"
        className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-slate-100">
            Analytics Dashboard
          </h1>
          <p className="text-sm text-slate-300">
            Drag cards to reorder them, or toggle widgets to personalize your
            workspace.
          </p>
          <p className="text-xs text-slate-500">
            Last updated: {new Date(data.lastUpdated).toLocaleString()}
          </p>
        </div>
        <PrivacyMaskToggle className="shrink-0 self-start" />
      </header>

      <DashboardClient initialData={data} />
    </>
  );
}

export default function DashboardPage() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div className="space-y-6">
            <StatCardSkeleton />
            <ChartSkeleton />
            <TableSkeleton rows={6} />
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
      <DashboardPortfolioAllocation />
      <DashboardWidgetGrid />
    </main>
  );
}
