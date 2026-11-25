import type { RscMigrationStage, RscRoutePlan } from "./types";

export const DASHBOARD_MIGRATION_PLAN: RscRoutePlan = {
  route: "/dashboard",
  stage: "streaming",
  serverComponents: ["DashboardPage", "DashboardHeader"],
  clientComponents: ["DashboardClient"],
};

export function isClientBoundary(componentName: string, plan: RscRoutePlan): boolean {
  return plan.clientComponents.includes(componentName);
}

export function getMigrationStage(route: string): RscMigrationStage {
  if (route === "/dashboard") {
    return DASHBOARD_MIGRATION_PLAN.stage;
  }
  return "complete";
}

export function describeMigrationPlan(plan: RscRoutePlan): string {
  return [
    `Route: ${plan.route}`,
    `Stage: ${plan.stage}`,
    `Server: ${plan.serverComponents.join(", ")}`,
    `Client: ${plan.clientComponents.join(", ")}`,
  ].join(" | ");
}
