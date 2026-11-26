import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { CommandPalette } from "@/components/CommandPalette";
import { LocaleProvider } from "@/context/LocaleContext";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from "@/i18n";
import { getTextDirection } from "@/i18n/formatting";

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
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value as Locale | undefined;
  const locale = cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale)
    ? cookieLocale
    : DEFAULT_LOCALE;

  return (
    <html lang={locale} dir={getTextDirection(locale)} suppressHydrationWarning>
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
      <body className="antialiased">
        <LocaleProvider defaultLocale={locale}>
          <CommandPalette />
          <div className="fixed bottom-4 right-4 z-50">
            <LocaleSwitcher compact showLabel={false} />
          </div>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
