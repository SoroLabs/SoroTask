import nextConfig from "../next.config";
import { generateCsp } from "../lib/csp-generator";

describe("Frontend Security Headers & Content Security Policy Configuration", () => {
  it("should export an async headers function", () => {
    expect(typeof nextConfig.headers).toBe("function");
  });

  it("should apply security headers to all routes (/:path*)", async () => {
    if (!nextConfig.headers) return;
    const headerConfigs = await nextConfig.headers();
    expect(headerConfigs.length).toBeGreaterThan(0);
    expect(headerConfigs[0].source).toBe("/:path*");
  });

  it("should configure strict Content-Security-Policy (CSP)", async () => {
    const csp = generateCsp({ nonce: "test-nonce", isDev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(
      "script-src 'self' 'strict-dynamic' 'nonce-test-nonce'",
    );
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("should configure X-Frame-Options DENY", async () => {
    if (!nextConfig.headers) return;
    const headerConfigs = await nextConfig.headers();
    const headers = headerConfigs[0].headers;
    const xfo = headers.find(
      (h: { key: string }) => h.key === "X-Frame-Options",
    );

    expect(xfo).toBeDefined();
    expect(xfo?.value).toBe("DENY");
  });

  it("should configure X-Content-Type-Options nosniff", async () => {
    if (!nextConfig.headers) return;
    const headerConfigs = await nextConfig.headers();
    const headers = headerConfigs[0].headers;
    const xcto = headers.find(
      (h: { key: string }) => h.key === "X-Content-Type-Options",
    );

    expect(xcto).toBeDefined();
    expect(xcto?.value).toBe("nosniff");
  });

  it("should configure HSTS Strict-Transport-Security", async () => {
    if (!nextConfig.headers) return;
    const headerConfigs = await nextConfig.headers();
    const headers = headerConfigs[0].headers;
    const hsts = headers.find(
      (h: { key: string }) => h.key === "Strict-Transport-Security",
    );

    expect(hsts).toBeDefined();
    expect(hsts?.value).toContain("max-age=63072000");
    expect(hsts?.value).toContain("includeSubDomains");
  });

  it("should configure Referrer-Policy strict-origin-when-cross-origin", async () => {
    if (!nextConfig.headers) return;
    const headerConfigs = await nextConfig.headers();
    const headers = headerConfigs[0].headers;
    const rp = headers.find(
      (h: { key: string }) => h.key === "Referrer-Policy",
    );

    expect(rp).toBeDefined();
    expect(rp?.value).toBe("strict-origin-when-cross-origin");
  });
});
