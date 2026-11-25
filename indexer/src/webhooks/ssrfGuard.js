const { isIP } = require("node:net");

/**
 * SSRF guard for outbound webhook requests (#1208).
 *
 * Webhook URLs are attacker-influenced (task creators register arbitrary
 * destinations), so every dispatch must validate that the target is a public
 * HTTP(S) endpoint. This rejects:
 *   - non-HTTP(S) schemes (file:, gopher:, ftp:, ...)
 *   - credentials in the URL (user:pass@host)
 *   - loopback / private / link-local IP literals (IPv4 and IPv6), including
 *     the cloud metadata endpoint 169.254.169.254
 *   - IPv4-mapped IPv6 literals pointing at private ranges
 *   - localhost and .local / .internal hostnames
 *
 * By default only literal validation is performed (no network I/O), so the
 * guard is safe to run synchronously in the dispatch hot path. Callers that
 * want hostname resolution checked too can pass `{ resolve: true }` (or their
 * own `lookup` implementation, e.g. to resolve over DoH or pin results).
 */

class SsrfError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SsrfError";
    this.code = code;
  }
}

/** Parses a dotted-quad IPv4 string into its 32-bit integer value, or null. */
function parseIPv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** True when an IPv4 string falls in a private/reserved/unroutable range. */
function isPrivateIPv4(ip) {
  const value = parseIPv4(ip);
  if (value === null) return true; // unparseable -> treat as unsafe
  const a = value >>> 24;
  const b = (value >>> 16) & 0xff;
  const c = (value >>> 8) & 0xff;
  if (value === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast (224-239), reserved (240-254), broadcast (255)
  return false;
}

/** True when an IPv6 string (lower-cased) is unsafe for outbound calls. */
function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified / loopback
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped: validate the embedded v4 address.
    const mapped = lower.slice(7);
    if (isIP(mapped) === 4) return isPrivateIPv4(mapped);
    return true;
  }
  const first = lower.split(":")[0] || "";
  if (/^fe[89ab]$/.test(first.slice(0, 3))) return true; // fe80::/10 link-local
  if (first === "fc" || first === "fd" || first.startsWith("fc") || first.startsWith("fd")) {
    return true; // fc00::/7 unique-local
  }
  if (first === "ff") return true; // multicast
  if (lower.startsWith("64:ff9b:")) return true; // NAT64 well-known prefix
  if (first === "2002") {
    // 6to4: embedded IPv4 occupies bits 16-48 (second hextet).
    const second = lower.split(":")[1] || "";
    if (second.length === 4) {
      const hi = parseInt(second.slice(0, 2), 16);
      const lo = parseInt(second.slice(2), 16);
      return isPrivateIPv4(`${hi}.${lo}`);
    }
  }
  if (lower.startsWith("2001:db8:")) return true; // documentation
  return false;
}

/**
 * Validates a hostname/IP literal. Returns an error message when blocked, or
 * null when the host looks public. Hostnames that are not IP literals and not
 * obviously local are allowed at this layer (see `resolve` for DNS checks).
 */
function validateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host) return "Empty hostname";
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "Loopback hostname is not allowed";
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return "Local-network hostname is not allowed";
  }

  const bare = host.replace(/^\[|\]$/g, ""); // strip [brackets] from IPv6
  const ipVersion = isIP(bare);
  if (ipVersion === 4 && isPrivateIPv4(bare)) {
    return `Private IPv4 address is not allowed: ${bare}`;
  }
  if (ipVersion === 6 && isPrivateIPv6(bare)) {
    return `Private IPv6 address is not allowed: ${bare}`;
  }
  return null;
}

/**
 * Validates that `url` is an outbound-safe public HTTP(S) endpoint.
 *
 * @param {string} url - The webhook destination URL.
 * @param {{ resolve?: boolean, lookup?: (host: string, cb: (err: Error|null, addr: string) => void) => void }} [options]
 *   `resolve` also DNS-resolves hostnames and validates every resolved
 *   address (off by default). `lookup` overrides the resolver (for tests).
 * @throws {SsrfError} when the URL must be rejected.
 */
async function assertPublicHttpUrl(url, options = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError("Webhook URL is not a valid URL", "SSRF_INVALID_URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SsrfError(
      `Webhook scheme must be http(s), got ${parsed.protocol}`,
      "SSRF_INVALID_SCHEME"
    );
  }
  if (parsed.username || parsed.password) {
    throw new SsrfError(
      "Webhook URL must not contain embedded credentials",
      "SSRF_CREDENTIALS"
    );
  }

  const hostError = validateHost(parsed.hostname);
  if (hostError) {
    throw new SsrfError(hostError, "SSRF_PRIVATE_HOST");
  }

  if (options.resolve) {
    const lookup =
      options.lookup ||
      ((host, cb) =>
        require("node:dns").lookup(host, { all: true }, (err, addresses) => {
          if (err) cb(err);
          else cb(null, addresses.map((entry) => entry.address));
        }));
    const addresses = await new Promise((resolvePromise, rejectPromise) => {
      lookup(parsed.hostname, (err, resolved) => {
        if (err) {
          rejectPromise(
            new SsrfError(`DNS lookup failed: ${err.message}`, "SSRF_DNS_ERROR")
          );
        } else {
          resolvePromise(resolved);
        }
      });
    });
    for (const address of addresses) {
      const version = isIP(address);
      const unsafe =
        version === 4
          ? isPrivateIPv4(address)
          : version === 6
            ? isPrivateIPv6(address)
            : true;
      if (unsafe) {
        throw new SsrfError(
          `Webhook hostname resolves to a private address: ${address}`,
          "SSRF_PRIVATE_HOST"
        );
      }
    }
  }
}

module.exports = {
  SsrfError,
  assertPublicHttpUrl,
  validateHost,
  isPrivateIPv4,
  isPrivateIPv6,
};
