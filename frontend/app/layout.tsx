import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoroTask Notification Preferences",
  description:
    "Manage in-app, browser, and email notification behavior for task events from one unified preference center.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
