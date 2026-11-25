import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { CommandPalette } from "@/components/CommandPalette";
import { PwaRegistration } from "@/components/pwa/PwaRegistration";
import { ClientInit } from "./ClientInit";
import { AppProviders } from "@/app/components/AppProviders";
import { AIAssistantProvider } from "@/components/AIAssistant";
import { ErrorBoundary } from "@sentry/nextjs";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getTextDirection } from "@/i18n";
import { ThemeInitScript } from "./theme-init";
import { THEME_STORAGE_KEY } from "@/src/lib/theme/themeEngine";
import { PriceTicker } from "@/src/components/PriceTicker";

function GlobalErrorFallback({ resetError }: any) {
import { TransactionToasts } from "@/src/components/TransactionToasts";

function GlobalErrorFallback({
  resetError,
}: {
  error: Error;
  resetError: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-900 text-neutral-100">
      <h2 className="mb-4 text-xl font-bold">Something went wrong!</h2>
      <button
        onClick={resetError}
        className="rounded bg-blue-600 px-4 py-2 hover:bg-blue-500"
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
  themeColor: "#09090b",
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <html
      lang={locale}
      dir={getTextDirection(locale)}
      suppressHydrationWarning
    >
  const nonce = (await headers()).get("x-nonce");
  if (!nonce) {
    throw new Error("Missing CSP nonce. Ensure the security proxy runs for this page.");
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
        <style
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
              :root { --font-fallback: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
              html, body { margin: 0; padding: 0; background-color: #0a0a0a; color: #f8fafc; font-family: var(--font-fallback); }
              *, *::before, *::after { box-sizing: border-box; }
              main { min-height: 100dvh; contain: layout style; }
            `,
          }}
        />
        <ThemeInitScript />
      </head>
      <body className="antialiased min-h-dvh w-full overflow-x-clip">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ErrorBoundary fallback={GlobalErrorFallback}>
            <ThemeProvider
              attribute="data-theme"
              defaultTheme="system"
              enableSystem
              storageKey={THEME_STORAGE_KEY}
              disableTransitionOnChange
            >
              <AIAssistantProvider>
                <AppProviders defaultLocale={locale}>
                  <PriceTicker />
                  <CommandPalette />
                  {children}
                </AppProviders>
              </AIAssistantProvider>
            </ThemeProvider>
          </ErrorBoundary>
        </NextIntlClientProvider>
        <ClientInit />
        <ThemeInitScript nonce={nonce} />
      </head>
      <body className="antialiased min-h-dvh w-full overflow-x-clip">
        <ClientInit />
        <ErrorBoundary fallback={GlobalErrorFallback}>
          <ThemeProvider>
          <ThemeProvider
            attribute="data-theme"
            defaultTheme="system"
            enableSystem
            storageKey={THEME_STORAGE_KEY}
            disableTransitionOnChange
          >
            <AIAssistantProvider>
              <AppProviders>
                <ClientInit />
                <PriceTicker />
                <CommandPalette />
                <TransactionToasts />
                {children}
              </AppProviders>
            </AIAssistantProvider>
          </ThemeProvider>
        </ErrorBoundary>
        <PwaRegistration />
      </body>
    </html>
  );
}
