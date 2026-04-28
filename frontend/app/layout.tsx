import type { Metadata } from "next";
import "./globals.css";
import { CommandPalette } from "@/components/CommandPalette";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CommandPalette />
        {children}
      </body>
    </html>
  );
}
