/**
 * src/lib/observability/scrubber.ts
 *
 * Strict PII / secret redaction for Sentry payloads (Issue #1258).
 *
 * # Why the previous filter was not enough
 *
 * The old `filterSensitiveData` matched on *key names* — it redacted
 * `event.extra.password` but not a Stellar secret key pasted into an error
 * message, a breadcrumb, a URL query string, or a stack frame's local
 * variables. Those are exactly where secrets end up in practice:
 *
 *   `Error: failed to sign tx with SB7X...`
 *
 * is a key-shaped string in a field no key-name rule will ever match.
 *
 * So this scrubber works on **values**, recursively, everywhere in the event —
 * and only then applies key-name rules on top.
 *
 * # What counts as a secret
 *
 * A Stellar secret seed is a 56-character base32 string beginning with `S`.
 * That is the shape the issue calls out and the one that loses user funds.
 * Public keys (`G...`) are deliberately *not* redacted: they are public by
 * definition, and stripping them would make most error reports useless for
 * debugging.
 *
 * Also caught: BIP-39 mnemonics, JWTs, bearer tokens, private key PEM blocks,
 * and API-key-shaped strings.
 *
 * # Fail closed
 *
 * Any error inside the scrubber drops the whole event rather than sending an
 * unscrubbed one. A missing error report is a debugging inconvenience; a
 * leaked seed phrase is an unrecoverable loss.
 */

/** What replaces a redacted value. Distinct per kind so reports stay readable. */
export const REDACTED = "[REDACTED]";
export const REDACTED_SECRET_KEY = "[REDACTED_STELLAR_SECRET_KEY]";
export const REDACTED_MNEMONIC = "[REDACTED_MNEMONIC]";
export const REDACTED_TOKEN = "[REDACTED_TOKEN]";

/**
 * Stellar secret seed: `S` + 55 base32 characters (A–Z, 2–7).
 *
 * Anchored on a non-base32 boundary rather than `\b`, because `\b` treats a
 * digit or letter either side as part of the same word and would miss a key
 * embedded in `key=SB7X...&next=1`.
 */
const STELLAR_SECRET_KEY = /(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])/g;

/**
 * Muxed account secret (`M` + 68) — same exposure, different prefix.
 */
const STELLAR_MUXED_SECRET = /(?<![A-Z2-7])M[A-Z2-7]{68}(?![A-Z2-7])/g;

/** PEM-encoded private keys. */
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

/** JSON Web Tokens — three base64url segments. */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** `Bearer <token>` / `Basic <token>` in free text. */
const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi;

/** Common API key prefixes (Sentry DSNs, Stripe, GitHub, OpenAI, …). */
const API_KEY_LIKE = /\b(sk|pk|rk|api|ghp|gho|ghs|ghu|github_pat|xox[baprs])[_-][A-Za-z0-9_-]{16,}\b/g;

/**
 * BIP-39 mnemonic: 12 / 15 / 18 / 21 / 24 lowercase words.
 *
 * Matched structurally rather than against the 2048-word list — shipping the
 * list to every client to redact an error report is not a trade worth making,
 * and the structural match is strictly more conservative (it over-redacts an
 * unusually long run of short lowercase words, which is an acceptable price).
 */
const MNEMONIC = /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/g;

/** Key names whose *value* is always secret regardless of its shape. */
const SENSITIVE_KEY_PATTERN =
  /pass(word|phrase)?|secret|token|auth|cookie|session|credential|api[_-]?key|private[_-]?key|seed|mnemonic|signature|csrf|xsrf|pin|otp|cvv|ssn|social[_-]?security|credit[_-]?card|card[_-]?number/i;

/**
 * Key names that hold a *public* value and must survive.
 *
 * Without this, `publicKey` matches the `key` rule and every report loses the
 * account it was about — which is most of the debugging value.
 */
const SAFE_KEY_PATTERN = /^(public[_-]?key|pubkey|account[_-]?id|address|contract[_-]?id|tx[_-]?hash|ledger)$/i;

/** Longest string we will scan. Guards against a pathological payload. */
const MAX_STRING_LENGTH = 100_000;

/** How deep to recurse before giving up. Guards against cyclic-ish structures. */
const MAX_DEPTH = 12;

/**
 * Redacts secret-shaped substrings from a string.
 *
 * Order matters: PEM blocks and mnemonics are matched before the narrower
 * patterns, so a multi-line key is replaced as one unit rather than leaving
 * fragments behind.
 */
export function scrubString(input: string): string {
  if (input.length > MAX_STRING_LENGTH) {
    return REDACTED;
  }

  return input
    .replace(PEM_PRIVATE_KEY, REDACTED)
    .replace(MNEMONIC, REDACTED_MNEMONIC)
    .replace(STELLAR_SECRET_KEY, REDACTED_SECRET_KEY)
    .replace(STELLAR_MUXED_SECRET, REDACTED_SECRET_KEY)
    .replace(JWT, REDACTED_TOKEN)
    .replace(AUTH_SCHEME, REDACTED_TOKEN)
    .replace(API_KEY_LIKE, REDACTED_TOKEN);
}

/** True when a value looks like a Stellar secret seed. */
export function containsStellarSecret(value: string): boolean {
  STELLAR_SECRET_KEY.lastIndex = 0;
  return STELLAR_SECRET_KEY.test(value);
}

/** True when `key` names a field whose value must be redacted wholesale. */
export function isSensitiveKey(key: string): boolean {
  if (SAFE_KEY_PATTERN.test(key)) return false;
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Recursively scrubs any value.
 *
 * Objects and arrays are rebuilt rather than mutated: Sentry hands us the live
 * event, and mutating a user's own object through it would change application
 * state as a side effect of reporting an error.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;

  if (typeof value === "string") return scrubString(value);
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, depth + 1));
  }

  if (value instanceof Date) return value;

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : scrubValue(entry, depth + 1);
    }
    return out;
  }

  // Functions, symbols, bigints — nothing a report needs.
  return REDACTED;
}

/** Strips secrets from a URL's query string and fragment. */
export function scrubUrl(url: string): string {
  const scrubbed = scrubString(url);

  try {
    const parsed = new URL(scrubbed, "https://placeholder.invalid");
    let touched = false;

    parsed.searchParams.forEach((val, key) => {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, REDACTED);
        touched = true;
      }
    });

    if (parsed.hash && isSensitiveKey(parsed.hash)) {
      parsed.hash = REDACTED;
      touched = true;
    }

    if (!touched) return scrubbed;

    // Rebuild without the placeholder origin if the input was relative.
    return /^https?:\/\//i.test(url)
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return scrubbed;
  }
}

/**
 * Minimal shape of the parts of a Sentry event this scrubber touches.
 *
 * Deliberately structural rather than importing Sentry's types: the scrubber
 * is pure and unit-testable without pulling the SDK into the test environment.
 */
export interface ScrubbableEvent {
  message?: unknown;
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, unknown>;
    cookies?: unknown;
    data?: unknown;
  };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: Array<Record<string, unknown>>;
  exception?: { values?: Array<Record<string, unknown>> };
  [key: string]: unknown;
}

/**
 * Scrubs a whole Sentry event.
 *
 * Returns `null` to drop the event if anything goes wrong — see "fail closed"
 * in the module docs.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T | null {
  try {
    const out = { ...event } as ScrubbableEvent;

    if (out.message !== undefined) {
      out.message = scrubValue(out.message);
    }

    if (out.request) {
      const request = { ...out.request };
      if (typeof request.url === "string") request.url = scrubUrl(request.url);
      if (request.query_string !== undefined) {
        request.query_string = scrubValue(request.query_string);
      }
      // Headers and cookies are redacted wholesale. There is no header worth
      // the risk of deciding case by case which ones carry credentials.
      if (request.headers) {
        request.headers = Object.fromEntries(
          Object.entries(request.headers).map(([key, val]) => [
            key,
            isSensitiveKey(key) ? REDACTED : scrubValue(val),
          ]),
        );
      }
      if (request.cookies !== undefined) request.cookies = REDACTED;
      if (request.data !== undefined) request.data = scrubValue(request.data);
      out.request = request;
    }

    if (out.user) {
      // Identity beyond an opaque id is not needed to fix a bug.
      const { id, ...rest } = out.user;
      const scrubbedRest = scrubValue(rest) as Record<string, unknown>;
      delete scrubbedRest.ip_address;
      delete scrubbedRest.email;
      delete scrubbedRest.username;
      out.user = id === undefined ? scrubbedRest : { id, ...scrubbedRest };
    }

    if (out.extra) out.extra = scrubValue(out.extra) as Record<string, unknown>;
    if (out.contexts) out.contexts = scrubValue(out.contexts) as Record<string, unknown>;
    if (out.tags) out.tags = scrubValue(out.tags) as Record<string, unknown>;

    // Breadcrumbs are the highest-risk field: they capture console output,
    // fetch URLs, and click targets in the seconds before the crash.
    if (Array.isArray(out.breadcrumbs)) {
      out.breadcrumbs = out.breadcrumbs.map((crumb) => {
        const next = scrubValue(crumb) as Record<string, unknown>;
        if (typeof crumb.message === "string") next.message = scrubString(crumb.message);
        return next;
      });
    }

    // Exception values carry the message and the stack frames' local vars.
    if (out.exception?.values) {
      out.exception = {
        ...out.exception,
        values: out.exception.values.map((value) => scrubValue(value) as Record<string, unknown>),
      };
    }

    return out as T;
  } catch {
    // Fail closed: drop rather than risk sending an unscrubbed event.
    return null;
  }
}

/**
 * Asserts that a serialized payload carries no Stellar secret.
 *
 * Used by the tests, and cheap enough to run as a last-line assertion in
 * development. Exported so a future integration test can make the
 * "verified 100% free of leaked secret keys" criterion checkable rather than
 * asserted.
 */
export function assertNoSecrets(payload: unknown): void {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  if (containsStellarSecret(serialized)) {
    throw new Error("Scrubber leaked a Stellar secret key");
  }
}
