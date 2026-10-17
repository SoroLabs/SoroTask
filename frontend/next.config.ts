import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const pluginFrameOrigins = (process.env.NEXT_PUBLIC_SOROTASK_PLUGIN_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    const url = new URL(origin);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        `Invalid plugin origin "${origin}". Plugin origins must be HTTPS origins without a path.`,
      );
    }

    return url.origin;
  });

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  turbopack: {},
  experimental: {
    useTypeScriptCli: true,
    sri: { algorithm: "sha384" },
    optimizePackageImports: [
      "lucide-react",
      "react-icons",
      "recharts",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "date-fns",
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-src 'self' ${pluginFrameOrigins.join(" ")};`,
          },
        ],
      },
    ];
  },
};

// Issue #813: wrap the default config so Sentry's webpack plugin instruments
// client, server, and edge bundles and uploads source maps on build. Runtime
// init lives in sentry.client/server/edge.config.ts; breadcrumbs for wallet
// connection and transaction lifecycle events are captured in
// src/lib/errors/breadcrumbs.ts.
export default withSentryConfig(nextConfig, {
  // Options below are only consulted when the corresponding env vars/org are
  // configured; builds without a Sentry DSN simply skip source-map upload.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});
