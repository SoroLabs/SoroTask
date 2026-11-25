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
};

// Runs before first paint to avoid theme flash
const themeScript = `
(function(){
  try {
    var m = localStorage.getItem('theme') || 'system';
    var resolved = m === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : m;
    document.documentElement.setAttribute('data-theme', resolved);
  } catch(e){}
})();
`;

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
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
