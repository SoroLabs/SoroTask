import {
  PhishingMitigator,
  defaultMitigator,
  type UrlValidationResult,
} from '../phishing-mitigation';

describe('PhishingMitigator', () => {
  let mitigator: PhishingMitigator;

  beforeEach(() => {
    mitigator = new PhishingMitigator({
      trustedDomains: ['sorotask.app', 'stellar.org'],
    });
  });

  describe('constructor', () => {
    it('constructs with default options without throwing', () => {
      expect(() => new PhishingMitigator()).not.toThrow();
    });

    it('accepts custom trusted domains', () => {
      expect(
        () => new PhishingMitigator({ trustedDomains: ['example.com'] }),
      ).not.toThrow();
    });

    it('throws when trustedDomains is an empty array', () => {
      expect(() => new PhishingMitigator({ trustedDomains: [] })).toThrow(
        /trustedDomains must be a non-empty array/,
      );
    });
  });

  describe('validate — valid safe URLs', () => {
    it('returns safe for a trusted HTTPS URL', () => {
      const result = mitigator.validate('https://sorotask.app/dashboard');
      expect(result.valid).toBe(true);
      expect(result.riskLevel).toBe('safe');
      expect(result.threatScore).toBe(0);
      expect(result.sanitizedUrl).toBe('https://sorotask.app/dashboard');
    });

    it('returns safe for a trusted subdomain', () => {
      const result = mitigator.validate('https://api.sorotask.app/tasks');
      expect(result.valid).toBe(true);
      expect(result.riskLevel).toBe('safe');
    });

    it('returns safe for stellar.org', () => {
      const result = mitigator.validate('https://stellar.org');
      expect(result.valid).toBe(true);
    });

    it('includes sanitizedUrl when safe', () => {
      const result = mitigator.validate('https://sorotask.app');
      expect(result.sanitizedUrl).toBe('https://sorotask.app/');
    });
  });

  describe('validate — blocked schemes', () => {
    it('blocks javascript: scheme', () => {
      const result = mitigator.validate('javascript:alert(1)');
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('dangerous');
      expect(result.threatScore).toBe(10);
      expect(result.sanitizedUrl).toBeNull();
      expect(result.reasons.some((r) => r.includes('javascript'))).toBe(true);
    });

    it('blocks data: scheme', () => {
      const result = mitigator.validate('data:text/html,<script>alert(1)</script>');
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('dangerous');
      expect(result.sanitizedUrl).toBeNull();
    });

    it('blocks vbscript: scheme', () => {
      const result = mitigator.validate('vbscript:msgbox(1)');
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('dangerous');
    });

    it('blocks blob: scheme', () => {
      const result = mitigator.validate('blob:https://evil.com/1234');
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('dangerous');
    });
  });

  describe('validate — unparseable input', () => {
    it('marks an empty string as dangerous', () => {
      const result = mitigator.validate('');
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('dangerous');
      expect(result.sanitizedUrl).toBeNull();
    });

    it('marks a non-string as dangerous', () => {
      const result = mitigator.validate(null as unknown as string);
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('dangerous');
    });

    it('marks a completely malformed URL as dangerous', () => {
      const result = mitigator.validate('not a url at all!!!');
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('dangerous');
    });
  });

  describe('validate — HTTP (insecure scheme)', () => {
    it('flags HTTP as suspicious by default', () => {
      const result = mitigator.validate('http://sorotask.app');
      expect(result.riskLevel).toBe('suspicious');
      expect(result.reasons.some((r) => r.toLowerCase().includes('http'))).toBe(true);
    });

    it('allows HTTP when allowHttpInDev is true', () => {
      const devMitigator = new PhishingMitigator({
        trustedDomains: ['sorotask.app'],
        allowHttpInDev: true,
      });
      const result = devMitigator.validate('http://sorotask.app');
      expect(result.riskLevel).toBe('safe');
    });
  });

  describe('validate — IP literal hosts', () => {
    it('flags IPv4 literal as suspicious/dangerous', () => {
      const result = mitigator.validate('https://192.168.1.1/phish');
      expect(result.riskLevel).not.toBe('safe');
      expect(result.reasons.some((r) => r.includes('IP address'))).toBe(true);
    });
  });

  describe('validate — embedded credentials', () => {
    it('flags URL with embedded username/password as dangerous', () => {
      const result = mitigator.validate('https://user:pass@sorotask.app');
      expect(result.riskLevel).toBe('dangerous');
      expect(result.sanitizedUrl).toBeNull();
      expect(result.reasons.some((r) => r.includes('credentials'))).toBe(true);
    });
  });

  describe('validate — open redirect params', () => {
    it('flags a URL with a redirect query param as suspicious', () => {
      const result = mitigator.validate(
        'https://sorotask.app/login?redirect=https://evil.com',
      );
      expect(result.riskLevel).toBe('suspicious');
      expect(result.reasons.some((r) => r.includes('open redirect'))).toBe(true);
    });

    it('flags common redirect param aliases', () => {
      const params = ['url', 'next', 'goto', 'return', 'returnurl', 'continue'];
      for (const param of params) {
        const result = mitigator.validate(
          `https://sorotask.app/?${param}=https://evil.com`,
        );
        expect(result.reasons.some((r) => r.includes('open redirect'))).toBe(true);
      }
    });
  });

  describe('validate — punycode / IDN', () => {
    it('flags a punycode-encoded domain', () => {
      const result = mitigator.validate('https://xn--sterlar-hvc.org/');
      expect(result.reasons.some((r) => r.includes('Punycode'))).toBe(true);
    });
  });

  describe('validate — suspicious TLD', () => {
    it('flags a .tk domain as suspicious', () => {
      const result = mitigator.validate('https://sorotask.tk');
      expect(result.reasons.some((r) => r.includes('TLD'))).toBe(true);
    });

    it('flags a .xyz domain when not in trusted list', () => {
      const result = mitigator.validate('https://evil.xyz');
      expect(result.reasons.some((r) => r.includes('TLD'))).toBe(true);
    });
  });

  describe('validate — untrusted domain', () => {
    it('flags an untrusted HTTPS domain as suspicious', () => {
      const result = mitigator.validate('https://notsorotask.com');
      expect(result.riskLevel).toBe('suspicious');
      expect(result.reasons.some((r) => r.includes('allowlist'))).toBe(true);
    });

    it('returns null sanitizedUrl for dangerous untrusted URL', () => {
      const result = mitigator.validate('https://192.168.1.1/phish');
      expect(result.sanitizedUrl).toBeNull();
    });
  });

  describe('isSafe', () => {
    it('returns true for a fully safe URL', () => {
      expect(mitigator.isSafe('https://sorotask.app')).toBe(true);
    });

    it('returns false for a JavaScript scheme URL', () => {
      expect(mitigator.isSafe('javascript:alert(1)')).toBe(false);
    });

    it('returns false for a suspicious untrusted URL', () => {
      expect(mitigator.isSafe('https://evil.com')).toBe(false);
    });
  });

  describe('sanitize', () => {
    it('returns the normalised href for a safe URL', () => {
      const result = mitigator.sanitize('https://sorotask.app/path');
      expect(result).toBe('https://sorotask.app/path');
    });

    it('returns null for a dangerous URL', () => {
      expect(mitigator.sanitize('javascript:void(0)')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(mitigator.sanitize('')).toBeNull();
    });
  });

  describe('defaultMitigator', () => {
    it('is a PhishingMitigator instance', () => {
      expect(defaultMitigator).toBeInstanceOf(PhishingMitigator);
    });

    it('accepts sorotask.app as safe', () => {
      expect(defaultMitigator.isSafe('https://sorotask.app')).toBe(true);
    });

    it('flags javascript: scheme as dangerous', () => {
      expect(defaultMitigator.isSafe('javascript:evil()')).toBe(false);
    });
  });

  describe('result structure', () => {
    it('always returns a UrlValidationResult with all required fields', () => {
      const result: UrlValidationResult = mitigator.validate('https://sorotask.app');
      expect(typeof result.valid).toBe('boolean');
      expect(['safe', 'suspicious', 'dangerous']).toContain(result.riskLevel);
      expect(typeof result.threatScore).toBe('number');
      expect(Array.isArray(result.reasons)).toBe(true);
    });

    it('reasons is empty for a fully safe URL', () => {
      const result = mitigator.validate('https://sorotask.app');
      expect(result.reasons).toHaveLength(0);
    });

    it('accumulates multiple reasons for a multi-flag URL', () => {
      const result = mitigator.validate('http://192.168.1.1/?redirect=evil');
      expect(result.reasons.length).toBeGreaterThan(1);
    });
  });
});
