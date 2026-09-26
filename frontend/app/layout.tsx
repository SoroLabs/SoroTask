import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CommandPalette } from "@/components/CommandPalette";
import { AppProviders } from "@/app/components/AppProviders";
import { AIAssistantProvider } from "@/components/AIAssistant";
import { ClientInit } from "./ClientInit";
import { ErrorBoundary } from "@sentry/nextjs";
import { ThemeProvider } from "next-themes";
import Link from "next/link";

function GlobalErrorFallback({ error, resetError }: any) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-neutral-100">
      <h2 className="text-xl font-bold mb-4">Something went wrong!</h2>
      <button onClick={resetError} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500">Try again</button>
    </div>
  );
}

export const metadata: Metadata = {
  title: "SoroTask Frontend Performance Monitoring",
  description:
    "Track route load, task open, search, and mutation responsiveness in the SoroTask frontend.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SoroTask",
  },
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-192x192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};



export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh w-full overflow-x-clip antialiased">
        <ErrorBoundary fallback={GlobalErrorFallback}>
          <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
            <AIAssistantProvider>
              <AppProviders>
                <CommandPalette />
                <div className="min-h-dvh w-full overflow-x-clip pb-16 md:pb-0">
                  {children}
                  <nav
                    aria-label="Mobile navigation"
                    className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-neutral-800 bg-neutral-950/95 pb-[env(safe-area-inset-bottom)] text-neutral-300 backdrop-blur md:hidden"
                  >
                    {[
                      ["Tasks", "/tasks"],
                      ["Board", "/board"],
                      ["Keepers", "/keepers"],
                      ["Settings", "/settings"],
                    ].map(([label, href]) => (
                      <Link
                        key={href}
                        href={href}
                        className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-medium active:bg-neutral-800"
                      >
                        <span className="truncate">{label}</span>
                      </Link>
                    ))}
                  </nav>
                </div>
              </AppProviders>
            </AIAssistantProvider>
          </ThemeProvider>
        </ErrorBoundary>
        {/* Initialize Sentry and fetch instrumentation on client */}
        <ClientInit />
      </body>
    </html>
  );
}
