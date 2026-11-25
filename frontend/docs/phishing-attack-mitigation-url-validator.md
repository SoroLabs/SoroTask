# Phishing Attack Mitigation and URL Validator

Issue [#578](https://github.com/SoroLabs/SoroTask/issues/578)

## Overview

`PhishingMitigator` is a stateless, pure-TypeScript class that validates URLs for phishing risk before they are rendered as links, used in navigation, or passed to external integrations. It implements multiple layers of defence and returns a structured result with a numeric threat score, risk level, and a list of individual reasons — enabling the caller to make risk-proportionate decisions (block outright, show a warning, or allow).

## Location

```
frontend/src/lib/phishing-mitigation.ts
frontend/src/lib/__tests__/phishing-mitigation.test.ts
```

## Architecture

```
PhishingMitigator
├── validate(rawUrl)    — full analysis, returns UrlValidationResult (O(D + P))
├── isSafe(rawUrl)      — convenience boolean (O(D + P))
└── sanitize(rawUrl)    — returns normalised href or null (O(D + P))

defaultMitigator        — pre-built instance with SoroTask's production allowlist
```

All detection logic is composed of pure functions that operate only on the parsed `URL` object — no DOM, no network I/O, no side effects. This makes every code path deterministic and fully unit-testable.

## Threat Detection Layers

| Layer | What it catches | Score added |
|---|---|---|
| Blocked scheme check | `javascript:`, `data:`, `vbscript:`, `blob:`, `file:` | 10 (immediate dangerous) |
| Insecure scheme | `http://` without dev override | 3 |
| Non-standard scheme | Anything other than `https`/`http` | 5 |
| IP-literal host | `192.168.x.x`, IPv6 literals | 4 |
| Punycode / IDN | Labels starting with `xn--` | 3 |
| Unicode homograph | Cyrillic/Greek lookalikes in host | 5 |
| Untrusted domain | Host not in `trustedDomains` allowlist | 2 |
| Suspicious TLD | `.tk`, `.ml`, `.ga`, `.cf`, `.gq`, `.xyz`, `.top` etc. | 2 |
| Open redirect param | `redirect`, `url`, `next`, `goto`, `return`, `continue` etc. | 3 |
| Embedded credentials | `user:pass@` in authority | 4 |
| Abnormal URL length | > 2048 characters | 1 |

### Risk Level Thresholds

| Score | Level | `valid` | `sanitizedUrl` |
|---|---|---|---|
| 0 | `safe` | `true` | href string |
| 1–3 | `suspicious` | `true` | href string |
| ≥ 4 | `dangerous` | `false` | `null` |

## Complexity

| Operation | Time | Space |
|---|---|---|
| `validate` | O(D + P) | O(1) |
| `isSafe` | O(D + P) | O(1) |
| `sanitize` | O(D + P) | O(1) |

D = number of trusted domain patterns. P = number of phishing pattern checks (constant, ~10).

## Usage

### Basic validation

```typescript
import { defaultMitigator } from '@/src/lib/phishing-mitigation';

const result = defaultMitigator.validate(userSuppliedUrl);

if (!result.valid) {
  console.warn('Blocked URL:', result.reasons);
  return;
}

window.open(result.sanitizedUrl!, '_blank', 'noopener,noreferrer');
```

### Custom allowlist (e.g., in tests or white-label deployments)

```typescript
import { PhishingMitigator } from '@/src/lib/phishing-mitigation';

const mitigator = new PhishingMitigator({
  trustedDomains: ['myapp.com', 'stellar.org'],
  allowHttpInDev: process.env.NODE_ENV === 'development',
});

const isSafe = mitigator.isSafe(link.href);
```

### Composing with sanitize.ts

```typescript
import { sanitizeHtml, addSafeLinkAttributes } from '@/src/lib/sanitize';
import { defaultMitigator } from '@/src/lib/phishing-mitigation';

function renderSafeLink(rawHref: string, label: string): string {
  const href = defaultMitigator.sanitize(rawHref);
  if (!href) return `<span>${label} (blocked)</span>`;
  const html = `<a href="${href}">${label}</a>`;
  return addSafeLinkAttributes(sanitizeHtml(html));
}
```

## Default Trusted Domains

The `defaultMitigator` export trusts the following domains and all their subdomains:

- `sorotask.app`
- `sorolabs.xyz`
- `stellar.org`
- `freighter.app`
- `stellarchain.io`
- `horizon.stellar.org`
- `soroban-testnet.stellar.org`

## Security Considerations

- **No network calls are made.** Detection is entirely static. This means newly-created phishing domains won't be caught unless they trigger one of the structural checks (IP, punycode, TLD, open-redirect param, untrusted domain).
- **The allowlist is the primary gate.** All external links not on the allowlist receive `+2` score; combined with any other flag they become dangerous.
- **Caller must enforce the `valid` flag.** `sanitizedUrl` being non-null is not sufficient — always check `result.valid` or use the `isSafe` / `sanitize` helpers which enforce it.
- **Homograph detection covers common Cyrillic/Greek substitutes** but is not exhaustive. Punycode detection is the more reliable backstop for IDN attacks.

## Test Coverage

Tests live in `src/lib/__tests__/phishing-mitigation.test.ts` and cover:

- Constructor default and custom options
- Empty `trustedDomains` validation error
- Safe trusted-HTTPS URLs (root, subdomain, path)
- All five blocked schemes (`javascript`, `data`, `vbscript`, `blob`, `file`)
- Unparseable inputs (empty string, null, garbage)
- HTTP insecure scheme (default block and dev override)
- IPv4 literal detection
- Embedded credential detection
- Open redirect query parameters (all aliased names)
- Punycode / IDN detection
- Suspicious TLD detection (`.tk`, `.xyz`)
- Untrusted domain scoring
- `isSafe` convenience method (safe, dangerous, suspicious cases)
- `sanitize` convenience method (safe return, null for dangerous)
- `defaultMitigator` pre-built instance
- Result shape invariants (all fields present, `reasons` empty for safe URLs, accumulated for multi-flag URLs)
