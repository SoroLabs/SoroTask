import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CommandPalette } from "@/components/CommandPalette";
import { AppProviders } from "@/app/components/AppProviders";
import { AIAssistantProvider } from "@/components/AIAssistant";
import { ClientInit } from "./ClientInit";
import { ErrorBoundary } from "@sentry/nextjs";
import { ThemeProvider } from "next-themes";
import { ThemeInitScript } from "./theme-init";
import { THEME_STORAGE_KEY } from "@/src/lib/theme/themeEngine";

function GlobalErrorFallback({ error, resetError }: any) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-neutral-100">
      <h2 className="text-xl font-bold mb-4">Something went wrong!</h2>
      <button
        onClick={resetError}
        className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500"
      >
        Try again
      </button>
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
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  // Media entries let the browser chrome follow the active theme; the
  // `default` covers the pre-resolve state before app/theme-init.tsx runs.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning` is required: the pre-paint script mutates the
    // <html> attributes, so the server and client markup legitimately differ.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Must precede the stylesheet's first paint — this is what makes the
            theme switch flicker-free (#1241). */}
        <ThemeInitScript />
      </head>
      <body className="antialiased">
        <ErrorBoundary fallback={GlobalErrorFallback}>
          <ThemeProvider
            attribute="data-theme"
            defaultTheme="system"
            enableSystem
            storageKey={THEME_STORAGE_KEY}
            // Suppresses transitions for the frame the theme changes, so a
            // switch does not animate a sweep across the whole page.
            disableTransitionOnChange
          >
            <AIAssistantProvider>
              <AppProviders>
                <CommandPalette />
                {children}
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
