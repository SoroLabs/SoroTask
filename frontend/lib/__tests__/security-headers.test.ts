import { createContentSecurityPolicy, getStaticSecurityHeaders } from "../security-headers";

const NONCE = "MDEyMzQ1Njc4OWFiY2RlZg==";

describe("createContentSecurityPolicy", () => {
  it("requires a nonce for scripts and blocks inline script attributes and framing", () => {
    const policy = createContentSecurityPolicy(NONCE);

    expect(policy).toContain(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`);
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy.match(/(?:^|; )script-src [^;]*/)?.[0]).not.toContain("'unsafe-inline'");
  });

  it("allows development eval only in development and includes only the configured keeper origin", () => {
    const policy = createContentSecurityPolicy(NONCE, {
      development: true,
      keeperUrl: "https://keeper.example.test:8443/path",
    });

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("https://keeper.example.test:8443");
    expect(policy).toContain("wss://keeper.example.test:8443");
    expect(policy).toContain("ws://localhost:3000");

    const productionPolicy = createContentSecurityPolicy(NONCE);
    expect(productionPolicy).not.toContain("'unsafe-eval'");
    expect(productionPolicy).not.toContain("localhost");
    expect(productionPolicy).toContain("upgrade-insecure-requests");
  });

  it("rejects invalid nonce values and unsafe keeper protocols", () => {
    expect(() => createContentSecurityPolicy("bad nonce")).toThrow(/base64/i);
    expect(() =>
      createContentSecurityPolicy(NONCE, { keeperUrl: "javascript:alert(1)" }),
    ).toThrow(/HTTP or HTTPS/i);
  });
});

describe("getStaticSecurityHeaders", () => {
  it("sets clickjacking, MIME sniffing, transport, and browser-feature protections", () => {
    expect(getStaticSecurityHeaders()).toMatchObject({
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
  });
});
