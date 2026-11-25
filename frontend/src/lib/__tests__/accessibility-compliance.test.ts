import {
  AccessibilityComplianceRunner,
  summarizeAccessibilityCompliance,
  type AccessibilityComplianceCheckResult,
} from '../accessibility/compliance';

describe('summarizeAccessibilityCompliance', () => {
  it('marks a report as failed when a serious issue appears', () => {
    const report = summarizeAccessibilityCompliance([
      {
        id: 'missing-label',
        name: 'form-labels',
        passed: false,
        severity: 'serious',
        message: 'A form control is missing a label.',
      } as AccessibilityComplianceCheckResult,
    ]);

    expect(report.status).toBe('fail');
    expect(report.issues).toHaveLength(1);
    expect(report.score).toBeLessThan(100);
  });

  it('keeps a report passing when every check succeeds', () => {
    const report = summarizeAccessibilityCompliance([
      {
        id: 'keyboard-nav',
        name: 'keyboard-navigation',
        passed: true,
        severity: 'minor',
        message: 'Keyboard navigation check passed.',
      } as AccessibilityComplianceCheckResult,
    ]);

    expect(report.status).toBe('pass');
    expect(report.issues).toHaveLength(0);
    expect(report.score).toBe(100);
  });
});

describe('AccessibilityComplianceRunner', () => {
  it('captures failed checks and exposes a warn status', async () => {
    const runner = new AccessibilityComplianceRunner({ enabled: false });
    const report = await runner.run([
      {
        id: 'contrast',
        name: 'color-contrast',
        passed: false,
        severity: 'moderate',
        message: 'Contrast is below threshold.',
      },
    ]);

    expect(report.status).toBe('warn');
    expect(report.issues).toHaveLength(1);
  });
});
