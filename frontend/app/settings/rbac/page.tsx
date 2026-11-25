"use client";

import { RbacDashboard } from "@/components/admin/RbacDashboard";
import { withRouteGuard } from "@/lib/routeGuards";

function RbacPage() {
  return <RbacDashboard />;
}

export default withRouteGuard(RbacPage, ["admin:users"], {
  redirectTo: "/unauthorized",
});
