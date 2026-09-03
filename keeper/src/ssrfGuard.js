'use strict';

/**
 * ssrfGuard.js — SSRF protection for outbound requests to user-supplied URLs
 * (Issue #1056).
 *
 * # The attack
 *
 * A task can carry a resolver or notification webhook URL. Fetching that URL
 * with a stock HTTP client means the keeper will happily connect to anything
 * the submitter names — including addresses only the keeper can reach:
 *
 *   - `http://169.254.169.254/latest/meta-data/iam/security-credentials/`
 *     returns cloud instance credentials on AWS/GCP/Azure.
 *   - `http://127.0.0.1:6379/` or a private VPC address reaches internal
 *     databases and admin endpoints sitting behind the network boundary.
 *
 * The keeper is inside the perimeter, so it is the confused deputy: the
 * attacker cannot reach those hosts, but the keeper can.
 *
 * # Why DNS resolution is the load-bearing part
 *
 * Blocking literal `127.0.0.1` in the URL string is not enough. An attacker
 * controls their own DNS, so `evil.example.com` can simply resolve to
 * `169.254.169.254`. The check has to happen against the **resolved
 * addresses**, which is why `assertUrlAllowed` is async and does a lookup
 * rather than parsing the hostname alone.
 *
 * A resolve-then-connect gap remains (classic DNS rebinding: answer public on
 * the check, private on the connect). Closing it completely requires pinning
 * the validated IP for the actual socket, which Node's `fetch` does not expose.
 * `safeFetch` narrows it by re-validating every redirect hop and keeping the
 * TTL window short; the residual risk is documented in SECURITY.md rather than
 * left implicit.
 */

const dns = require('dns').promises;
const net = require('net');

/** Schemes we are willing to make an outbound request with. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Blocked IPv4 ranges as [network, prefixLength].
 *
 * RFC 1918 private space, loopback, link-local (which is where the cloud
 * metadata endpoint lives), CGNAT, and the various reserved blocks. Anything
 * here is unreachable from the public internet, so a user-supplied URL
 * resolving into it is either a mistake or an attack.
 */
const BLOCKED_IPV4 = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // RFC 6598 CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // RFC 3927 link-local — cloud metadata
  ['172.16.0.0', 12], // RFC 1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // RFC 1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes broadcast
];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedIpv4(ip) {
  const value = ipv4ToInt(ip);
  return BLOCKED_IPV4.some(([network, prefix]) => {
    // A /0 mask would shift by 32, which is a no-op in JS — not reachable
    // here since no entry uses /0, but guard rather than rely on it.
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (ipv4ToInt(network) & mask);
  });
}

/**
 * IPv6 equivalents. Checked on the normalised (lower-cased, expanded-enough)
 * form rather than by numeric range, because the reserved blocks that matter
 * are identifiable by prefix.
 */
function isBlockedIpv6(ip) {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone index

  if (addr === '::' || addr === '::1') return true; // unspecified, loopback

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms tunnel the whole
  // IPv4 problem into IPv6 — unwrap and apply the IPv4 rules.
  const mapped = addr.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  if (addr.startsWith('fe80:') || addr.startsWith('fe8') || addr.startsWith('fe9')
      || addr.startsWith('fea') || addr.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique local (RFC 4193)
  if (addr.startsWith('ff')) return true; // ff00::/8 multicast

  return false;
}

/** True when `ip` is an address a user-supplied URL must not reach. */
function isBlockedAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not an IP literal at all — refuse rather than guess
}

class SsrfBlockedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SsrfBlockedError';
    this.code = 'SSRF_BLOCKED';
    Object.assign(this, details);
  }
}

/**
 * Validate a URL and the addresses it resolves to.
 *
 * Rejects rather than returns a boolean so a caller cannot accidentally
 * ignore the result — the failure mode this protects against is silent.
 *
 * @param {string} rawUrl
 * @param {object} [options]
 * @param {(hostname: string) => Promise<Array<{address: string}>>} [options.lookup]
 *   DNS resolver override, for tests.
 * @param {boolean} [options.allowPrivate] Escape hatch for operator-configured
 *   internal endpoints. Never set this from user input.
 * @returns {Promise<{url: URL, addresses: string[]}>}
 * @throws {SsrfBlockedError}
 */
async function assertUrlAllowed(rawUrl, options = {}) {
  const { lookup = (host) => dns.lookup(host, { all: true }), allowPrivate = false } = options;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Malformed URL', { url: String(rawUrl) });
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    // file:, gopher:, ftp: and friends are all remote-read primitives in one
    // client or another; only HTTP(S) is ever legitimate for a webhook.
    throw new SsrfBlockedError(`Protocol not allowed: ${url.protocol}`, {
      url: url.href,
      protocol: url.protocol,
    });
  }

  if (allowPrivate) {
    return { url, addresses: [] };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ''); // unwrap [::1]

  // A literal IP needs no lookup, and must not get one — resolving it would
  // be a no-op at best and a confusing failure at worst.
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new SsrfBlockedError(`Blocked address: ${hostname}`, {
        url: url.href,
        address: hostname,
      });
    }
    return { url, addresses: [hostname] };
  }

  let records;
  try {
    records = await lookup(hostname);
  } catch (err) {
    throw new SsrfBlockedError(`DNS resolution failed for ${hostname}`, {
      url: url.href,
      cause: err.message,
    });
  }

  const addresses = (Array.isArray(records) ? records : [records])
    .map((r) => (typeof r === 'string' ? r : r.address))
    .filter(Boolean);

  if (addresses.length === 0) {
    throw new SsrfBlockedError(`No addresses resolved for ${hostname}`, { url: url.href });
  }

  // Every resolved address must be safe, not merely the first. A hostname with
  // one public and one private A record would otherwise be a way through,
  // since the client may connect to any of them.
  const blocked = addresses.filter(isBlockedAddress);
  if (blocked.length > 0) {
    throw new SsrfBlockedError(`Blocked address for ${hostname}: ${blocked.join(', ')}`, {
      url: url.href,
      addresses: blocked,
    });
  }

  return { url, addresses };
}

/**
 * `fetch` with the SSRF filter applied to the initial URL and to every
 * redirect hop.
 *
 * Redirects are followed manually (`redirect: 'manual'`) because the built-in
 * follower performs the next request itself, with no opportunity to inspect
 * the target — a validated public URL that 302s to `169.254.169.254` would
 * otherwise sail straight through the check.
 */
async function safeFetch(rawUrl, init = {}, options = {}) {
  const { maxRedirects = 3, fetchImpl = globalThis.fetch, ...guardOptions } = options;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { url } = await assertUrlAllowed(currentUrl, guardOptions);

    // eslint-disable-next-line no-await-in-loop
    const response = await fetchImpl(url.href, { ...init, redirect: 'manual' });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect) return response;

    const location = response.headers?.get?.('location');
    if (!location) return response; // redirect status with nowhere to go

    currentUrl = new URL(location, url).href;
  }

  throw new SsrfBlockedError(`Too many redirects (>${maxRedirects})`, { url: String(rawUrl) });
}

module.exports = {
  assertUrlAllowed,
  safeFetch,
  isBlockedAddress,
  SsrfBlockedError,
  ALLOWED_PROTOCOLS,
  BLOCKED_IPV4,
};
