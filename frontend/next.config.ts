import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

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
  webpack: (config, { isServer }) => {
    // Enable WASM async module support and streaming
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Optimize vendor chunk splitting for heavy crypto/math libraries
    if (!isServer && config.optimization?.splitChunks) {
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        chunks: "all",
        maxInitialRequests: 25,
        minSize: 20000,
        cacheGroups: {
          ...config.optimization.splitChunks.cacheGroups,
          stellar: {
            test: /[\\/]node_modules[\\/](@stellar|stellar-sdk)[\\/]/,
            name: "vendor-stellar",
            priority: 40,
            enforce: true,
          },
          cryptoModules: {
            test: /[\\/]node_modules[\\/](snarkjs|circomlibjs|elliptic|bn\.js)[\\/]/,
            name: "vendor-crypto-zk",
            priority: 35,
            enforce: true,
          },
          charts: {
            test: /[\\/]node_modules[\\/](recharts|d3|d3-[^\\/]+)[\\/]/,
            name: "vendor-charts",
            priority: 30,
            enforce: true,
          },
          graph: {
            test: /[\\/]node_modules[\\/](reactflow|dagre|three)[\\/]/,
            name: "vendor-graph",
            priority: 25,
            enforce: true,
          },
        },
      };
    }

    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          {
            key: "Link",
            value:
              "<https://soroban-testnet.stellar.org>; rel=preconnect; crossorigin, <https://rpc-mainnet.stellar.org>; rel=dns-prefetch",
          },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const withIntl = withNextIntl(nextConfig);

// Issue #813: wrap the default config so Sentry's webpack plugin instruments
// client, server, and edge bundles and uploads source maps on build. Runtime
// init lives in sentry.client/server/edge.config.ts; breadcrumbs for wallet
// connection and transaction lifecycle events are captured in
// src/lib/errors/breadcrumbs.ts.
export default withSentryConfig(withIntl, {
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
