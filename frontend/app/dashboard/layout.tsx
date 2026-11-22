import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Dashboard | SoroTask",
  description: "Enterprise task scheduling, execution automation, and analytics dashboard.",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
