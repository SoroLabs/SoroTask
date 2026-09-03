import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https:;
  font-src 'self' data:;
  connect-src 'self' https://*.stellar.org https://*.soroban.org https://soroban-testnet.stellar.org https://horizon-testnet.stellar.org wss://*.stellar.org http://localhost:* ws://localhost:*;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: cspHeader,
  },
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
  turbopack: {},
  experimental: {
    useTypeScriptCli: true,
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
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