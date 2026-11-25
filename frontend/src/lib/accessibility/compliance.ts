export type AccessibilityComplianceSeverity = 'critical' | 'serious' | 'moderate' | 'minor';
export type AccessibilityComplianceStatus = 'pass' | 'warn' | 'fail';

export interface AccessibilityComplianceIssue {
  id: string;
  rule: string;
  severity: AccessibilityComplianceSeverity;
  message: string;
  source: 'runtime' | 'ci' | 'manual';
  timestamp: number;
  element?: string;
}

export interface AccessibilityComplianceCheckResult {
  id: string;
  name: string;
  passed: boolean;
  severity?: AccessibilityComplianceSeverity;
  message?: string;
  source?: 'runtime' | 'ci' | 'manual';
}

export interface AccessibilityComplianceReport {
  status: AccessibilityComplianceStatus;
  checkedAt: number;
  durationMs: number;
  score: number;
  issues: AccessibilityComplianceIssue[];
  checks: AccessibilityComplianceCheckResult[];
}

export interface AccessibilityComplianceConfig {
  enabled?: boolean;
  failOn?: AccessibilityComplianceSeverity[];
  storageKey?: string;
}

const SEVERITY_WEIGHT: Record<AccessibilityComplianceSeverity, number> = {
  minor: 1,
  moderate: 2,
  serious: 3,
  critical: 4,
};

const DEFAULT_FAIL_ON: AccessibilityComplianceSeverity[] = ['serious', 'critical'];

export function summarizeAccessibilityCompliance(
  checks: AccessibilityComplianceCheckResult[],
  startedAt = Date.now(),
  config: AccessibilityComplianceConfig = {}
): AccessibilityComplianceReport {
  const issues: AccessibilityComplianceIssue[] = checks
    .filter((check) => !check.passed)
    .map((check) => ({
      id: check.id,
      rule: check.name,
      severity: check.severity ?? 'moderate',
      message: check.message ?? 'Accessibility compliance check failed.',
      source: check.source ?? 'runtime',
      timestamp: Date.now(),
    }));

  const weightedPenalty = issues.reduce(
    (acc, issue) => acc + SEVERITY_WEIGHT[issue.severity] * 10,
    0
  );
  const score = Math.max(0, 100 - Math.min(weightedPenalty, 100));
  const failOn = config.failOn ?? DEFAULT_FAIL_ON;
  const status = issues.some((issue) => failOn.includes(issue.severity))
    ? 'fail'
    : issues.length > 0
      ? 'warn'
      : 'pass';

  return {
    status,
    checkedAt: Date.now(),
    durationMs: Math.max(0, Date.now() - startedAt),
    score,
    issues,
    checks,
  };
}

export class AccessibilityComplianceRunner {
  private readonly config: AccessibilityComplianceConfig;

  constructor(config: AccessibilityComplianceConfig = {}) {
    this.config = config;
  }

  async run(
    checks: Array<
      | AccessibilityComplianceCheckResult
      | (() => AccessibilityComplianceCheckResult | Promise<AccessibilityComplianceCheckResult>)
    > = []
  ): Promise<AccessibilityComplianceReport> {
    const startedAt = Date.now();
    const results: AccessibilityComplianceCheckResult[] = [];

    for (const entry of checks) {
      try {
        const result = typeof entry === 'function' ? await entry() : entry;
        results.push(result);
      } catch (error) {
        results.push({
          id: 'runner-failure',
          name: 'compliance-pipeline',
          passed: false,
          severity: 'serious',
          message: error instanceof Error ? error.message : 'Unknown accessibility compliance failure.',
          source: 'ci',
        });
      }
    }

    const report = summarizeAccessibilityCompliance(results, startedAt, this.config);
    this.persist(report);
    return report;
  }

  private persist(report: AccessibilityComplianceReport) {
    if (typeof window === 'undefined' || this.config.enabled === false) {
      return;
    }

    try {
      const storageKey = this.config.storageKey ?? 'sorotask:a11y-compliance';
      window.localStorage.setItem(storageKey, JSON.stringify(report));
    } catch {
      // Fallback to a no-op when storage is not available.
    }

    try {
      window.dispatchEvent(
        new CustomEvent('sorotask:a11y-compliance', { detail: report })
      );
    } catch {
      // Fallback to console reporting if custom events are unavailable.
      if (typeof console !== 'undefined' && report.status !== 'pass') {
        console.warn('Accessibility compliance report', report);
      }
    }
  }
}

export function readStoredAccessibilityComplianceReport(
  storageKey = 'sorotask:a11y-compliance'
): AccessibilityComplianceReport | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as AccessibilityComplianceReport) : null;
  } catch {
    return null;
  }
}
