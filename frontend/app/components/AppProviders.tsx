"use client";

import { Toaster } from "sonner";
import { WalletProvider, useWallet } from "@/app/context/WalletContext";
import { WalletConnectionModal } from "@/app/components/WalletConnectionModal";
import { OnboardingProvider } from "@/src/components/onboarding/OnboardingProvider";
import { JankProfilerProvider } from "@/src/components/JankProfilerProvider";
import {
  AccessibilityComplianceProvider,
  AccessibilityComplianceStatus,
} from "@/src/components/accessibility/AccessibilityComplianceProvider";
import { TransactionToasts } from "@/src/components/TransactionToasts";

import { useState } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { SessionProvider } from "next-auth/react";
import { LocaleProvider } from "@/context/LocaleContext";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/src/lib/query/queryClient";
import type { Locale } from "@/i18n";

function WalletConnectModalHost() {
  const { isConnectModalOpen, closeConnectModal } = useWallet();

  return (
    <WalletConnectionModal
      open={isConnectModalOpen}
      onClose={closeConnectModal}
    />
  );
}

export function AppProviders({
  children,
  defaultLocale,
}: {
  children: React.ReactNode;
  defaultLocale?: Locale;
}) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider defaultLocale={defaultLocale}>
        <SessionProvider>
          <AuthProvider>
            <JankProfilerProvider>
              <AccessibilityComplianceProvider>
                <WalletProvider>
                  <OnboardingProvider>
                    {children}
                    <AccessibilityComplianceStatus />
                    <WalletConnectModalHost />
                    <TransactionToasts />
                  </OnboardingProvider>
                </WalletProvider>
              </AccessibilityComplianceProvider>
            </JankProfilerProvider>
          </AuthProvider>
        </SessionProvider>
      </LocaleProvider>
      {/* Mounted once here so every page can fire toasts (transaction
          lifecycle, execution rollback, etc.) without its own <Toaster/>. */}
      <Toaster
        position="bottom-right"
        theme="dark"
        closeButton
        richColors
        toastOptions={{
          style: {
            background: "#1e293b",
            borderColor: "#334155",
            color: "#f8fafc",
          },
        }}
      />
    </QueryClientProvider>
  );
}
