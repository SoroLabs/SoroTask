import { generateCsp } from '../csp-generator';

describe('CSP Generator', () => {
  it('generates a base CSP string correctly', () => {
    const csp = generateCsp({ isDev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it('includes nonce in script-src when provided', () => {
    const csp = generateCsp({ nonce: 'test-nonce-123', isDev: false });
    expect(csp).toContain("'nonce-test-nonce-123'");
  });

  it('allows development eval without enabling inline scripts', () => {
    const csp = generateCsp({ isDev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('merges extra directives correctly', () => {
    const csp = generateCsp({
      isDev: false,
      extraDirectives: {
        'connect-src': ['https://api.sorotask.com'],
        'worker-src': ["'self'"]
      }
    });

    expect(csp).toContain("connect-src 'self' https://api.sorotask.com");
    expect(csp).toContain("worker-src 'self'");
  });

  it('includes report-uri when provided', () => {
    const csp = generateCsp({ isDev: false, reportUri: 'https://sorotask.report-uri.com/r/d/csp/enforce' });
    expect(csp).toContain("report-uri https://sorotask.report-uri.com/r/d/csp/enforce");
  });
});
