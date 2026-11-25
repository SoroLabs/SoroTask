import { scanTargetContract, DEFAULT_SCAM_LIST } from '../phishing-mitigation';
import type { TargetScanResult } from '../phishing-mitigation';

/** A syntactically valid Stellar address that is not on the scam list. */
const GOOD = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const SCAM = DEFAULT_SCAM_LIST[0].address;

const codes = (r: TargetScanResult) => r.findings.map((f) => f.code);
const message = (r: TargetScanResult, code: string) =>
  r.findings.find((f) => f.code === code)?.message ?? '';

describe('scanTargetContract — verified contracts', () => {
  it('passes a fully verified contract', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      hasVerifiedSource: true,
      ageDays: 400,
      maxAgeDays: 30,
    });

    expect(result.riskLevel).toBe('safe');
    expect(result.requiresConfirmation).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it('flags an unverified contract as a caution', () => {
    const result = scanTargetContract({ address: GOOD });

    expect(result.riskLevel).toBe('caution');
    expect(codes(result)).toContain('unverified_bytecode');
    // Advisory only: an unverified contract should not hard-block signing.
    expect(result.requiresConfirmation).toBe(false);
  });
});

describe('scanTargetContract — address handling', () => {
  it('echoes the address back for display', () => {
    expect(scanTargetContract({ address: GOOD }).address).toBe(GOOD);
  });

  it('normalises lowercase and surrounding whitespace', () => {
    expect(scanTargetContract({ address: GOOD.toLowerCase() }).address).toBe(GOOD);
    expect(scanTargetContract({ address: `  ${GOOD}  ` }).address).toBe(GOOD);
  });

  it('accepts a lowercase address as well-formed', () => {
    expect(codes(scanTargetContract({ address: GOOD.toLowerCase() }))).not.toContain(
      'malformed_address',
    );
  });

  it.each([
    ['empty', ''],
    ['words', 'not-an-address'],
    ['too short', GOOD.slice(0, 55)],
    ['too long', `${GOOD}X`],
    ['wrong prefix', 'S'.repeat(56)],
  ])('rejects a %s address', (_label, address) => {
    const result = scanTargetContract({ address });

    expect(result.riskLevel).toBe('high');
    expect(codes(result)).toContain('malformed_address');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('stops after a malformed address, since nothing else is trustworthy', () => {
    const result = scanTargetContract({
      address: 'bad',
      isProxy: true,
      origin: 'https://evil.com',
      appOrigin: 'https://sorotask.app',
    });

    expect(result.findings).toHaveLength(1);
  });
});

describe('scanTargetContract — scam list', () => {
  it('flags a reported address as critical', () => {
    const result = scanTargetContract({ address: SCAM });

    expect(result.riskLevel).toBe('high');
    expect(codes(result)).toContain('reported_scam');
    expect(result.findings.find((f) => f.code === 'reported_scam')?.severity).toBe('critical');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('includes the report count and label in the message', () => {
    const result = scanTargetContract({ address: SCAM });

    expect(message(result, 'reported_scam')).toMatch(/reported 47 times/);
    expect(message(result, 'reported_scam')).toMatch(/Drainer/);
  });

  it('matches the scam list case-insensitively', () => {
    expect(codes(scanTargetContract({ address: SCAM.toLowerCase() }))).toContain('reported_scam');
  });

  it('flags a single report and uses singular wording', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      reportedContracts: [{ address: GOOD, reports: 1, label: 'Test report' }],
    });

    expect(codes(result)).toContain('reported_scam');
    expect(message(result, 'reported_scam')).toMatch(/reported 1 time as/);
  });
});

describe('scanTargetContract — bytecode and proxies', () => {
  it('treats changed bytecode as critical', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      wasmHash: 'abc123',
      expectedWasmHash: 'def456',
    });

    expect(result.findings.find((f) => f.code === 'unverified_bytecode')?.severity).toBe(
      'critical',
    );
    expect(result.riskLevel).toBe('high');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('accepts matching bytecode', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      wasmHash: 'abc123',
      expectedWasmHash: 'abc123',
    });

    expect(result.riskLevel).toBe('safe');
  });

  it('does not claim a mismatch from a single hash', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      wasmHash: 'abc123',
    });

    expect(result.riskLevel).toBe('safe');
  });

  it('flags an upgradeable proxy as a warning', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      isProxy: true,
    });

    expect(codes(result)).toContain('proxy_contract');
    expect(result.findings.find((f) => f.code === 'proxy_contract')?.severity).toBe('warning');
    expect(result.riskLevel).toBe('caution');
  });
});

describe('scanTargetContract — contract age and source', () => {
  it('flags a contract with no track record', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      ageDays: 3,
      maxAgeDays: 30,
    });

    expect(codes(result)).toContain('fresh_contract');
    expect(message(result, 'fresh_contract')).toMatch(/3 days old/);
  });

  it('uses singular wording for a one-day-old contract', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      ageDays: 1,
      maxAgeDays: 30,
    });

    expect(message(result, 'fresh_contract')).toMatch(/1 day old/);
  });

  it('does not flag a contract past the age threshold', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      ageDays: 90,
      maxAgeDays: 30,
    });

    expect(codes(result)).not.toContain('fresh_contract');
  });

  it('treats missing source as informational only', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      hasVerifiedSource: false,
    });

    expect(codes(result)).toContain('missing_source');
    expect(result.findings.find((f) => f.code === 'missing_source')?.severity).toBe('info');
    expect(result.riskLevel).toBe('safe');
  });
});


describe('scanTargetContract — origin verification', () => {
  it('treats a look-alike origin as critical', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      origin: 'https://sorotask-app.net',
      appOrigin: 'https://sorotask.app',
    });

    expect(result.findings.find((f) => f.code === 'origin_mismatch')?.severity).toBe('critical');
    expect(result.riskLevel).toBe('high');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('names both origins so the user can compare them', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      origin: 'https://sorotask-app.net',
      appOrigin: 'https://sorotask.app',
    });

    expect(message(result, 'origin_mismatch')).toMatch(/sorotask-app\.net/);
    expect(message(result, 'origin_mismatch')).toMatch(/sorotask\.app/);
  });

  it('accepts a matching origin', () => {
    const result = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      origin: 'https://sorotask.app',
      appOrigin: 'https://sorotask.app',
    });

    expect(codes(result)).not.toContain('origin_mismatch');
    expect(result.riskLevel).toBe('safe');
  });
});

describe('scanTargetContract — combined findings', () => {
  it('accumulates every finding and lets critical dominate', () => {
    const result = scanTargetContract({
      address: SCAM,
      isProxy: true,
      hasVerifiedSource: false,
      origin: 'https://evil.example',
      appOrigin: 'https://sorotask.app',
    });

    expect(result.findings.length).toBeGreaterThanOrEqual(4);
    expect(result.riskLevel).toBe('high');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('leads with the most severe finding', () => {
    const result = scanTargetContract({ address: SCAM, isProxy: true });

    expect(result.findings[0].severity).toBe('critical');
  });
});

