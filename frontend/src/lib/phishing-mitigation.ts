/**
 * Phishing Attack Mitigation and URL Validator
 *
 * Provides defence-in-depth against phishing by:
 *   1. Validating URLs against a strict allowlist of trusted domains.
 *   2. Detecting homograph / IDN lookalike attacks using Unicode confusable
 *      detection and punycode inspection.
 *   3. Blocking known phishing patterns (open redirects, data URIs, JS
 *      protocol handlers, IP-literal hosts, abnormal port usage).
 *   4. Scoring URLs with a numeric threat level so callers can make
 *      risk-proportionate decisions (block vs. warn vs. allow).
 *
 * Architectural boundaries:
 *   - Pure functions and a single stateless class — no DOM, no network I/O.
 *   - All public API is type-safe and throws only on programmer error (e.g.
 *     invalid allowlist entries), never on malicious input.
 *   - Integrates cleanly with the existing sanitize.ts / tracking.ts layers.
 *
 * Time Complexity:  O(D + P) per validation call
 *   D = number of trusted domain patterns
 *   P = number of phishing pattern checks (fixed constant)
 * Space Complexity: O(D) for the compiled allowlist
 */

export type UrlRiskLevel = 'safe' | 'suspicious' | 'dangerous';

export interface UrlValidationResult {
  valid: boolean;
  riskLevel: UrlRiskLevel;
  threatScore: number;
  reasons: string[];
  sanitizedUrl: string | null;
}

export interface PhishingMitigatorOptions {
  trustedDomains?: string[];
  allowHttpInDev?: boolean;
}

const DEFAULT_TRUSTED_DOMAINS: ReadonlyArray<string> = [
  'sorotask.app',
  'sorolabs.xyz',
  'stellar.org',
  'freighter.app',
  'stellarchain.io',
  'horizon.stellar.org',
  'soroban-testnet.stellar.org',
];

const BLOCKED_SCHEMES = new Set([
  'javascript',
  'data',
  'vbscript',
  'blob',
  'file',
]);

const SUSPICIOUS_TLD = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.work', '.click',
]);

const REDIRECT_PARAMS = new Set([
  'url', 'redirect', 'return', 'returnurl', 'next', 'goto', 'redir',
  'redirect_uri', 'continue', 'destination', 'forward',
]);

const HOMOGRAPH_LOOK_ALIKES: ReadonlyMap<string, string> = new Map([
  ['ο', 'o'],
  ['о', 'o'],
  ['0', 'o'],
  ['1', 'l'],
  ['l', '1'],
  ['rn', 'm'],
  ['vv', 'w'],
  ['ɑ', 'a'],
  ['а', 'a'],
  ['е', 'e'],
  ['ё', 'e'],
  ['і', 'i'],
  ['ï', 'i'],
  ['ο', 'o'],
  ['р', 'p'],
  ['ѕ', 's'],
]);

function scoreToRisk(score: number): UrlRiskLevel {
  if (score === 0) return 'safe';
  if (score <= 3) return 'suspicious';
  return 'dangerous';
}

function normaliseDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^www\./, '');
}

function isIpLiteral(host: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^\[.*\]$/;
  return ipv4.test(host) || ipv6.test(host);
}

function hasPunycode(host: string): boolean {
  return host.split('.').some((label) => label.startsWith('xn--'));
}

function detectHomograph(host: string): boolean {
  const normalised = host.toLowerCase();
  for (const [lookalike] of HOMOGRAPH_LOOK_ALIKES) {
    if (normalised.includes(lookalike) && /[^\x00-\x7F]/.test(lookalike)) {
      return true;
    }
  }
  return false;
}

function hasOpenRedirectParam(url: URL): boolean {
  for (const [key] of url.searchParams) {
    if (REDIRECT_PARAMS.has(key.toLowerCase())) return true;
  }
  return false;
}

function domainMatchesTrusted(
  host: string,
  trustedSet: ReadonlyArray<string>,
): boolean {
  const normalised = normaliseDomain(host);
  return trustedSet.some((trusted) => {
    const t = normaliseDomain(trusted);
    return normalised === t || normalised.endsWith(`.${t}`);
  });
}

function hasSuspiciousTld(host: string): boolean {
  return SUSPICIOUS_TLD.has(
    host.slice(host.lastIndexOf('.')).toLowerCase(),
  );
}

export class PhishingMitigator {
  private readonly trustedDomains: ReadonlyArray<string>;
  private readonly allowHttpInDev: boolean;

  constructor({
    trustedDomains = [...DEFAULT_TRUSTED_DOMAINS],
    allowHttpInDev = false,
  }: PhishingMitigatorOptions = {}) {
    if (!Array.isArray(trustedDomains) || trustedDomains.length === 0) {
      throw new Error('trustedDomains must be a non-empty array');
    }
    this.trustedDomains = trustedDomains.map((d) => d.toLowerCase().trim());
    this.allowHttpInDev = allowHttpInDev;
  }

  /**
   * Validate a URL string for phishing risk.
   *
   * Returns a UrlValidationResult describing:
   *   - whether the URL is considered valid for navigation
   *   - a risk level (safe / suspicious / dangerous)
   *   - a numeric threat score (0 = clean, higher = more dangerous)
   *   - individual reasons for any raised flags
   *   - a sanitized URL string (null when URL is invalid or dangerous)
   *
   * O(D + P) per call.
   */
  validate(rawUrl: string): UrlValidationResult {
    const reasons: string[] = [];
    let score = 0;

    if (!rawUrl || typeof rawUrl !== 'string') {
      return {
        valid: false,
        riskLevel: 'dangerous',
        threatScore: 10,
        reasons: ['Input is not a valid string'],
        sanitizedUrl: null,
      };
    }

    const trimmed = rawUrl.trim();

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return {
        valid: false,
        riskLevel: 'dangerous',
        threatScore: 10,
        reasons: ['URL could not be parsed'],
        sanitizedUrl: null,
      };
    }

    const scheme = parsed.protocol.replace(':', '').toLowerCase();

    if (BLOCKED_SCHEMES.has(scheme)) {
      return {
        valid: false,
        riskLevel: 'dangerous',
        threatScore: 10,
        reasons: [`Blocked URL scheme: ${scheme}`],
        sanitizedUrl: null,
      };
    }

    if (scheme === 'http') {
      if (!this.allowHttpInDev) {
        score += 3;
        reasons.push('Insecure HTTP scheme — use HTTPS');
      }
    } else if (scheme !== 'https') {
      score += 5;
      reasons.push(`Non-standard scheme: ${scheme}`);
    }

    const host = parsed.hostname.toLowerCase();

    if (isIpLiteral(host)) {
      score += 4;
      reasons.push('URL uses a raw IP address instead of a domain name');
    }

    if (hasPunycode(host)) {
      score += 3;
      reasons.push('Punycode-encoded domain detected — possible IDN homograph attack');
    }

    if (detectHomograph(host)) {
      score += 5;
      reasons.push('Unicode homograph characters detected in domain');
    }

    const isTrusted = domainMatchesTrusted(host, this.trustedDomains);
    if (!isTrusted) {
      score += 2;
      reasons.push(`Domain is not in the trusted allowlist: ${host}`);
    }

    if (hasSuspiciousTld(host)) {
      score += 2;
      reasons.push(`Domain uses a high-risk TLD: ${host.slice(host.lastIndexOf('.'))}`);
    }

    if (hasOpenRedirectParam(parsed)) {
      score += 3;
      reasons.push('URL contains a query parameter commonly used for open redirect attacks');
    }

    if (parsed.username || parsed.password) {
      score += 4;
      reasons.push('URL contains embedded credentials — likely credential-harvesting attempt');
    }

    if (parsed.href.length > 2048) {
      score += 1;
      reasons.push('Abnormally long URL — may be attempting to obscure destination');
    }

    const riskLevel = scoreToRisk(score);
    const valid = riskLevel !== 'dangerous';

    return {
      valid,
      riskLevel,
      threatScore: score,
      reasons,
      sanitizedUrl: valid ? parsed.href : null,
    };
  }

  /**
   * Returns true only when a URL is fully safe (trusted domain, HTTPS, no flags).
   * O(D + P).
   */
  isSafe(rawUrl: string): boolean {
    return this.validate(rawUrl).riskLevel === 'safe';
  }

  /**
   * Returns the sanitized URL string, or null when dangerous.
   * O(D + P).
   */
  sanitize(rawUrl: string): string | null {
    return this.validate(rawUrl).sanitizedUrl;
  }
}

export const defaultMitigator = new PhishingMitigator();

// ---------------------------------------------------------------------------
// Malicious target contract screening (issue #1247)
//
// The URL mitigator above protects navigation. This part protects the thing a
// task actually automates: the contract the user's XLM is sent to. A user can
// be tricked into pointing a recurring transfer at an attacker's address, so
// the target is screened before any signature is requested.
// ---------------------------------------------------------------------------

export type TargetRiskLevel = 'safe' | 'caution' | 'high';

export type TargetFindingCode =
  | 'malformed_address'
  | 'reported_scam'
  | 'fresh_contract'
  | 'unverified_bytecode'
  | 'proxy_contract'
  | 'suspicious_origin'
  | 'origin_mismatch'
  | 'missing_source';

export type TargetFinding = {
  code: TargetFindingCode;
  severity: 'info' | 'warning' | 'critical';
  message: string;
};

export type TargetScanResult = {
  address: string;
  riskLevel: TargetRiskLevel;
  /** True when the user must explicitly acknowledge before signing. */
  requiresConfirmation: boolean;
  findings: TargetFinding[];
};

export type ContractReputation = {
  address: string;
  /** Community report count; 1+ is enough to warn. */
  reports: number;
  label?: string;
};

/** What is known about a contract before the user signs. */
export type TargetScanInput = {
  address: string;
  /** Contracts confirmed by the team. Absent = unverified. */
  verifiedContracts?: readonly string[];
  /** Community scam reports keyed by address. */
  reportedContracts?: readonly ContractReputation[];
  /** WebAssembly hash, hex. */
  wasmHash?: string;
  /** Hash of the bytecode the UI believes it is about to sign against. */
  expectedWasmHash?: string;
  /** True when the contract is an upgradeable/proxy deployment. */
  isProxy?: boolean;
  /** Contracts younger than this are flagged as unproven. */
  maxAgeDays?: number;
  /** Age of the contract in days. */
  ageDays?: number;
  /** Page origin the task was configured from. */
  origin?: string;
  /** Origin the app is actually served from. */
  appOrigin?: string;
  /** Contract source repository; absent = unaudited. */
  hasVerifiedSource?: boolean;
};

/** Known malicious deployments. Extend per deployment, not per user. */
export const DEFAULT_SCAM_LIST: readonly ContractReputation[] = [
  {
    address: 'GB2XDSWHTYCWQL3F36HYJ4XWWDKJRVLSGY5RRCQMAJTCXJPBMPHSHDWQ',
    reports: 47,
    label: 'Drainer impersonating a Soroban DEX router',
  },
  {
    address: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
    reports: 12,
    label: 'Fake airdrop claim contract',
  },
];

const STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

/** Strip separators a user may paste along with the address. */
function normaliseAddress(raw: string): string {
  return raw.trim().replace(/[\s:]/g, '').toUpperCase();
}


/**
 * Screen a target contract before a signature is requested.
 *
 * Findings accumulate rather than short-circuiting, so the warning modal can
 * show every reason at once. Reporting only the first problem would invite the
 * user to fix it, re-scan, and then meet the next.
 *
 * O(R + S) per call for R reports and S verified contracts.
 */
export function scanTargetContract(input: TargetScanInput): TargetScanResult {
  const findings: TargetFinding[] = [];
  const address = normaliseAddress(input.address ?? '');

  // --- 1. Address shape -------------------------------------------------
  if (!STELLAR_ADDRESS_PATTERN.test(address)) {
    findings.push({
      code: 'malformed_address',
      severity: 'critical',
      message:
        'This does not look like a Stellar contract address. A valid address starts with G and is 56 characters long.',
    });
    // Nothing else can be checked reliably against a malformed address.
    return { address, riskLevel: 'high', requiresConfirmation: true, findings };
  }

  // --- 2. Community reports -------------------------------------------
  const report = (input.reportedContracts ?? DEFAULT_SCAM_LIST).find(
    (entry) => normaliseAddress(entry.address) === address,
  );
  if (report) {
    findings.push({
      code: 'reported_scam',
      severity: 'critical',
      message: `This address has been reported ${report.reports} time${
        report.reports === 1 ? '' : 's'
      }${report.label ? ` as ${report.label}` : ''}. Do not send funds to it.`,
    });
  }

  // --- 3. Verification status -----------------------------------------
  const verified = (input.verifiedContracts ?? []).some(
    (entry) => normaliseAddress(entry) === address,
  );
  if (!verified) {
    findings.push({
      code: 'unverified_bytecode',
      severity: 'warning',
      message:
        'This contract is not on the verified list, so its code has not been checked by the SoroLabs team.',
    });
  }

  // Bytecode that no longer matches what the UI rendered means the code changed
  // between display and signing — the classic upgradeable-contract trap.
  if (
    input.expectedWasmHash !== undefined &&
    input.wasmHash !== undefined &&
    input.expectedWasmHash !== input.wasmHash
  ) {
    findings.push({
      code: 'unverified_bytecode',
      severity: 'critical',
      message:
        'The contract bytecode changed since it was displayed. It may have been upgraded to redirect your funds.',
    });
  }

  // --- 4. Proxy / upgradeability --------------------------------------
  if (input.isProxy) {
    findings.push({
      code: 'proxy_contract',
      severity: 'warning',
      message:
        'This is an upgradeable proxy. Its behaviour can change at any time without warning, including where your funds go.',
    });
  }

  // --- 5. Contract age --------------------------------------------------
  if (input.ageDays !== undefined && input.maxAgeDays !== undefined && input.ageDays < input.maxAgeDays) {
    findings.push({
      code: 'fresh_contract',
      severity: 'warning',
      message: `This contract is only ${input.ageDays} day${
        input.ageDays === 1 ? '' : 's'
      } old, so it has no track record.`,
    });
  }

  // --- 6. Source verification ------------------------------------------
  if (input.hasVerifiedSource === false) {
    findings.push({
      code: 'missing_source',
      severity: 'info',
      message: 'No verified source code is published for this contract.',
    });
  }

  // --- 7. Origin verification ------------------------------------------
  if (input.origin && input.appOrigin && input.origin !== input.appOrigin) {
    findings.push({
      code: 'origin_mismatch',
      severity: 'critical',
      message: `This task was created on ${input.origin} but you are on ${input.appOrigin}. You may be on a look-alike site.`,
    });
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasWarning = findings.some((f) => f.severity === 'warning');
  const riskLevel: TargetRiskLevel = hasCritical ? 'high' : hasWarning ? 'caution' : 'safe';

  return {
    address,
    riskLevel,
    // A critical finding must always be acknowledged; warnings stay advisory.
    requiresConfirmation: hasCritical,
    findings,
  };
}
