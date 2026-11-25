"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityComplianceRunner,
  readStoredAccessibilityComplianceReport,
  type AccessibilityComplianceCheckResult,
  type AccessibilityComplianceConfig,
  type AccessibilityComplianceReport,
} from '@/src/lib/accessibility/compliance';

interface AccessibilityComplianceContextValue {
  lastReport: AccessibilityComplianceReport | null;
  runComplianceCheck: (
    checks?: Array<
      | AccessibilityComplianceCheckResult
      | (() => AccessibilityComplianceCheckResult | Promise<AccessibilityComplianceCheckResult>)
    >
  ) => Promise<AccessibilityComplianceReport>;
}

const AccessibilityComplianceContext = createContext<AccessibilityComplianceContextValue | null>(null);

interface AccessibilityComplianceProviderProps {
  children: ReactNode;
  config?: AccessibilityComplianceConfig;
}

export function AccessibilityComplianceProvider({
  children,
  config,
}: AccessibilityComplianceProviderProps) {
  const runnerRef = useRef(new AccessibilityComplianceRunner(config));
  const [lastReport, setLastReport] = useState<AccessibilityComplianceReport | null>(() =>
    readStoredAccessibilityComplianceReport(config?.storageKey)
  );

  const runComplianceCheck = useCallback(
    async (
      checks: Array<
        | AccessibilityComplianceCheckResult
        | (() => AccessibilityComplianceCheckResult | Promise<AccessibilityComplianceCheckResult>)
      > = []
    ) => {
      const report = await runnerRef.current.run(checks);
      setLastReport(report);
      return report;
    },
    []
  );

  useEffect(() => {
    if (config?.enabled === false) {
      return;
    }

    void runComplianceCheck();
  }, [config?.enabled, runComplianceCheck]);

  const value = useMemo(
    () => ({
      lastReport,
      runComplianceCheck,
    }),
    [lastReport, runComplianceCheck]
  );

  return (
    <AccessibilityComplianceContext.Provider value={value}>
      {children}
    </AccessibilityComplianceContext.Provider>
  );
}

export function useAccessibilityCompliance() {
  const context = useContext(AccessibilityComplianceContext);
  if (!context) {
    throw new Error('useAccessibilityCompliance must be used within AccessibilityComplianceProvider');
  }
  return context;
}

export function AccessibilityComplianceStatus() {
  const { lastReport } = useAccessibilityCompliance();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !lastReport || process.env.NODE_ENV === 'production') {
    return null;
  }

  const tone =
    lastReport.status === 'fail'
      ? 'border-red-500/60 bg-red-950/90 text-red-100'
      : lastReport.status === 'warn'
        ? 'border-amber-500/60 bg-amber-950/90 text-amber-100'
        : 'border-emerald-500/60 bg-emerald-950/90 text-emerald-100';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${tone}`}
    >
      <p className="font-semibold">Accessibility compliance {lastReport.status}</p>
      <p className="mt-1 text-xs opacity-90">
        {lastReport.issues.length > 0
          ? `${lastReport.issues.length} issue${lastReport.issues.length > 1 ? 's' : ''} detected`
          : 'No issues detected'}
      </p>
    </div>
  );
}
