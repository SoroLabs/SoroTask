const STATIC_SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
} as const;

function getKeeperOrigins(keeperUrl: string | undefined): string[] {
  if (!keeperUrl) return [];

  let url: URL;
  try {
    url = new URL(keeperUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_KEEPER_URL must be an absolute URL to the keeper service.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_KEEPER_URL must use HTTP or HTTPS.");
  }

  const httpOrigin = url.origin;
  const websocketOrigin = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  return [httpOrigin, websocketOrigin];
}

export function createContentSecurityPolicy(
  nonce: string,
  options: { development?: boolean; keeperUrl?: string } = {},
): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(nonce)) {
    throw new Error("CSP nonce must be a base64-encoded value.");
  }

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(options.development ? ["'unsafe-eval'"] : []),
  ];
  const connectionSources = [
    "'self'",
    "https://*.stellar.org",
    ...getKeeperOrigins(options.keeperUrl),
    ...(options.development ? ["ws://localhost:3000", "ws://127.0.0.1:3000"] : []),
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src ${connectionSources.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(options.development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function getStaticSecurityHeaders(): Record<string, string> {
  return { ...STATIC_SECURITY_HEADERS };
}
