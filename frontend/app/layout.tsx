import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CommandPalette } from "@/components/CommandPalette";
import { AppProviders } from "@/app/components/AppProviders";
import { AIAssistantProvider } from "@/components/AIAssistant";
import { ClientInit } from "./ClientInit";
import { ErrorBoundary } from "@sentry/nextjs";
import { ThemeProvider } from "./theme/ThemeProvider";

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
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning` is required: the pre-paint script mutates the
    // <html> attributes, so the server and client markup legitimately differ.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Pre-warm connections to Soroban RPC endpoints for instant transactions */}
        <link
          rel="preconnect"
          href="https://soroban-testnet.stellar.org"
          crossOrigin=""
        />
        <link rel="dns-prefetch" href="https://soroban-testnet.stellar.org" />
        <link
          rel="preconnect"
          href="https://rpc-mainnet.stellar.org"
          crossOrigin=""
        />
        <link rel="dns-prefetch" href="https://rpc-mainnet.stellar.org" />

        {/* Inline critical CSS for instantaneous first paint (LCP < 1.2s, CLS = 0) */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root { --font-fallback: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
              html, body { margin: 0; padding: 0; background-color: #0a0a0a; color: #f8fafc; font-family: var(--font-fallback); }
              *, *::before, *::after { box-sizing: border-box; }
              main { min-height: 100dvh; contain: layout style; }
            `,
          }}
        />

        {/* Must precede the stylesheet's first paint — this is what makes the
            theme switch flicker-free (#1241). */}
        <ThemeInitScript />
      </head>
      <body className="antialiased min-h-dvh w-full overflow-x-clip">
        <ErrorBoundary fallback={GlobalErrorFallback}>
          <ThemeProvider>
            <AIAssistantProvider>
              <AppProviders>
                <PriceTicker />
                <CommandPalette />
                <TransactionToasts />
                {children}
              </AppProviders>
            </AIAssistantProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
