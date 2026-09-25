/**
 * Tests for Sentry secret scrubbing (Issue #1258).
 *
 * The acceptance criterion is "verified 100% free of leaked secret keys", so
 * the important assertions are the ones that serialize the *whole* scrubbed
 * event and search it for a key — a field-by-field check would pass while a
 * secret sat in a field nobody thought to assert on.
 */

import {
  assertNoSecrets,
  containsStellarSecret,
  isSensitiveKey,
  REDACTED,
  REDACTED_SECRET_KEY,
  REDACTED_TOKEN,
  scrubEvent,
  scrubString,
  scrubUrl,
  scrubValue,
} from "../scrubber";

/** A syntactically valid Stellar secret seed: S + 55 base32 chars. */
const SECRET = `S${"A".repeat(55)}`;
const SECRET_2 = `SB${"CDEFGH234567".repeat(4)}ABC`.slice(0, 56);
const PUBLIC_KEY = `G${"A".repeat(55)}`;

describe("containsStellarSecret", () => {
  it("detects a bare secret seed", () => {
    expect(containsStellarSecret(SECRET)).toBe(true);
  });

  it("does not flag a public key", () => {
    // Public keys are public. Redacting them would strip the account an error
    // report is about, which is most of its debugging value.
    expect(containsStellarSecret(PUBLIC_KEY)).toBe(false);
  });

  it("does not flag a short S-prefixed string", () => {
    expect(containsStellarSecret("SHORTSTRING")).toBe(false);
  });
});

describe("scrubString", () => {
  it("redacts a secret embedded in an error message", () => {
    // The case a key-name filter can never catch.
    const message = `Error: failed to sign tx with ${SECRET} on testnet`;
    const out = scrubString(message);

    expect(out).not.toContain(SECRET);
    expect(out).toContain(REDACTED_SECRET_KEY);
    // The surrounding text survives, so the report stays useful.
    expect(out).toContain("failed to sign tx");
    expect(out).toContain("on testnet");
  });

  it("redacts a secret in a query string without word boundaries", () => {
    // `\b` would miss this; the pattern uses a base32 boundary instead.
    const out = scrubString(`?key=${SECRET}&next=1`);

    expect(out).not.toContain(SECRET);
    expect(out).toContain("next=1");
  });

  it("redacts every secret when several appear", () => {
    const out = scrubString(`${SECRET} and ${SECRET_2}`);

    expect(containsStellarSecret(out)).toBe(false);
  });

  it("leaves a public key intact", () => {
    expect(scrubString(`account ${PUBLIC_KEY}`)).toContain(PUBLIC_KEY);
  });

  it("redacts a BIP-39-shaped mnemonic", () => {
    const mnemonic =
      "legal winner thank year wave sausage worth useful legal winner thank yellow";
    expect(scrubString(`seed: ${mnemonic}`)).not.toContain("sausage");
  });

  it("redacts a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const out = scrubString(`Authorization failed for ${jwt}`);

    expect(out).not.toContain(jwt);
    expect(out).toContain(REDACTED_TOKEN);
  });

  it("redacts a bearer token in free text", () => {
    const out = scrubString("sent Bearer abcdef0123456789abcdef");
    expect(out).toContain(REDACTED_TOKEN);
    expect(out).not.toContain("abcdef0123456789abcdef");
  });

  it("redacts a PEM private key block", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEAxyz",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    expect(scrubString(`key was ${pem}`)).not.toContain("MIIEowIBAAKCAQEAxyz");
  });

  it("drops an absurdly long string wholesale", () => {
    expect(scrubString("x".repeat(200_000))).toBe(REDACTED);
  });
});

describe("isSensitiveKey", () => {
  it("flags credential-shaped names", () => {
    for (const key of ["password", "secretKey", "apiKey", "authToken", "seed", "mnemonic"]) {
      expect(isSensitiveKey(key)).toBe(true);
    }
  });

  it("spares names that hold public values", () => {
    // `publicKey` contains "key"; without the allow-list every report would
    // lose the account it was about.
    for (const key of ["publicKey", "accountId", "address", "contractId", "txHash"]) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });
});

describe("scrubValue", () => {
  it("recurses into nested objects", () => {
    const out = scrubValue({
      level1: { level2: { message: `boom ${SECRET}` } },
    });

    assertNoSecrets(out);
  });

  it("recurses into arrays", () => {
    assertNoSecrets(scrubValue([{ note: SECRET }, [SECRET]]));
  });

  it("redacts a sensitive key's value regardless of shape", () => {
    const out = scrubValue({ password: "hunter2" }) as Record<string, unknown>;
    expect(out.password).toBe(REDACTED);
  });

  it("does not mutate the input", () => {
    // Sentry hands us the live event; mutating through it would change
    // application state as a side effect of reporting an error.
    const input = { note: `key ${SECRET}` };
    scrubValue(input);
    expect(input.note).toContain(SECRET);
  });

  it("preserves primitives and structure", () => {
    const out = scrubValue({ count: 3, ok: true, nothing: null }) as Record<string, unknown>;
    expect(out).toEqual({ count: 3, ok: true, nothing: null });
  });

  it("stops at a depth limit rather than recursing forever", () => {
    let deep: Record<string, unknown> = { secret: SECRET };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };

    expect(() => scrubValue(deep)).not.toThrow();
    assertNoSecrets(scrubValue(deep));
  });
});

describe("scrubUrl", () => {
  it("redacts a secret in the query string", () => {
    const out = scrubUrl(`https://sorotask.app/sign?seed=${SECRET}`);

    expect(out).not.toContain(SECRET);
    expect(out).toContain("sorotask.app");
  });

  it("redacts a sensitive parameter by name", () => {
    expect(scrubUrl("https://sorotask.app/x?token=abc123")).not.toContain("abc123");
  });

  it("keeps a benign url unchanged", () => {
    const url = "https://sorotask.app/tasks/42";
    expect(scrubUrl(url)).toBe(url);
  });

  it("handles a relative url", () => {
    expect(scrubUrl("/tasks?page=2")).toBe("/tasks?page=2");
  });
});

describe("scrubEvent", () => {
  /** An event with a secret in every field a real crash could put one in. */
  function eventWithSecretsEverywhere() {
    return {
      message: `sign failed ${SECRET}`,
      request: {
        url: `https://sorotask.app/sign?seed=${SECRET}`,
        query_string: `seed=${SECRET}`,
        headers: { Authorization: `Bearer ${SECRET}`, "User-Agent": "test" },
        cookies: `session=${SECRET}`,
        data: { body: SECRET },
      },
      user: {
        id: "user-1",
        email: "someone@example.com",
        ip_address: "203.0.113.1",
        username: "someone",
        secretKey: SECRET,
      },
      extra: { walletSeed: SECRET, note: `recovered with ${SECRET}` },
      contexts: { wallet: { secret: SECRET } },
      tags: { key: SECRET },
      breadcrumbs: [
        { category: "console", message: `logged ${SECRET}` },
        { category: "fetch", data: { url: `https://x.test?seed=${SECRET}` } },
      ],
      exception: {
        values: [{ value: `threw ${SECRET}`, type: "Error" }],
      },
    };
  }

  it("leaves no Stellar secret anywhere in the serialized event", () => {
    // The assertion that actually matches the acceptance criterion.
    const scrubbed = scrubEvent(eventWithSecretsEverywhere());

    expect(scrubbed).not.toBeNull();
    expect(() => assertNoSecrets(scrubbed)).not.toThrow();
    expect(JSON.stringify(scrubbed)).not.toContain(SECRET);
  });

  it("scrubs the exception message, where stack traces put secrets", () => {
    const scrubbed = scrubEvent(eventWithSecretsEverywhere());
    expect(JSON.stringify(scrubbed?.exception)).not.toContain(SECRET);
  });

  it("scrubs breadcrumbs, including console output and fetch urls", () => {
    const scrubbed = scrubEvent(eventWithSecretsEverywhere());
    expect(JSON.stringify(scrubbed?.breadcrumbs)).not.toContain(SECRET);
  });

  it("drops cookies wholesale", () => {
    const scrubbed = scrubEvent(eventWithSecretsEverywhere());
    expect(scrubbed?.request?.cookies).toBe(REDACTED);
  });

  it("strips identifying user fields but keeps the opaque id", () => {
    // The id is what correlates reports; email and IP are not needed to fix
    // a bug.
    const scrubbed = scrubEvent(eventWithSecretsEverywhere());

    expect(scrubbed?.user?.id).toBe("user-1");
    expect(scrubbed?.user?.email).toBeUndefined();
    expect(scrubbed?.user?.ip_address).toBeUndefined();
    expect(scrubbed?.user?.username).toBeUndefined();
  });

  it("keeps the debugging context that carries no secret", () => {
    // Over-redaction makes reports useless, which is its own failure mode.
    const scrubbed = scrubEvent({
      message: "Contract call reverted",
      tags: { section: "task-detail", txHash: "abc123" },
      extra: { publicKey: PUBLIC_KEY, ledger: 55123 },
    });

    expect(scrubbed?.message).toBe("Contract call reverted");
    expect(scrubbed?.tags?.section).toBe("task-detail");
    expect(scrubbed?.extra?.publicKey).toBe(PUBLIC_KEY);
    expect(scrubbed?.extra?.ledger).toBe(55123);
  });

  it("does not mutate the event it was given", () => {
    const event = eventWithSecretsEverywhere();
    scrubEvent(event);
    expect(event.message).toContain(SECRET);
  });

  it("drops the event entirely if scrubbing throws", () => {
    // Fail closed. A missing report is an inconvenience; a leaked seed is not.
    const hostile = {
      get message() {
        throw new Error("boom");
      },
    };

    expect(scrubEvent(hostile as never)).toBeNull();
  });

  it("handles an empty event without throwing", () => {
    expect(scrubEvent({})).toEqual({});
  });
});

describe("assertNoSecrets", () => {
  it("throws when a secret survives", () => {
    expect(() => assertNoSecrets({ leaked: SECRET })).toThrow(/leaked a Stellar secret/i);
  });

  it("passes on clean output", () => {
    expect(() => assertNoSecrets({ fine: PUBLIC_KEY })).not.toThrow();
  });
});
