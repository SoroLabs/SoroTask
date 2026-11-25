#!/usr/bin/env node
/**
 * Upload source maps to Sentry after Next.js build
 *
 * Usage:
 *   node scripts/upload-sourcemaps.js
 *
 * Environment variables:
 *   SENTRY_AUTH_TOKEN - Sentry auth token (required)
 *   SENTRY_ORG - Sentry organization slug (required)
 *   SENTRY_PROJECT - Sentry project slug (required)
 *   NEXT_PUBLIC_SENTRY_DSN - Sentry DSN (for extracting org/project if not set)
 *   CI - Set to "true" to enable upload (prevents upload in local dev)
 */

require('dotenv').config({ path: '../../.env' });
const { execSync } = require('child_process');
const path = require('path');

// Only run in CI or when explicitly requested
if (process.env.CI !== 'true' && process.env.UPLOAD_SOURCE_MAPS !== 'true') {
  console.log('Skipping source map upload (not in CI)');
  console.log('Set UPLOAD_SOURCE_MAPS=true to force upload');
  process.exit(0);
}

const requiredEnv = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
const missing = requiredEnv.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Please set these in your CI/CD environment.');
  process.exit(1);
}

try {
  console.log('Uploading source maps to Sentry...');

  execSync(
    `npx @sentry/nextjs@latest sourcemaps --org ${process.env.SENTRY_ORG} --project ${process.env.SENTRY_PROJECT} .next`,
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    }
  );

  console.log('✅ Source maps uploaded successfully');
} catch (error) {
  console.error('❌ Failed to upload source maps:', error.message);
  process.exit(1);
}
