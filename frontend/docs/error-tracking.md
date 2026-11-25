# Error Tracking Setup Guide

This document describes the comprehensive error tracking system implemented in SoroTask frontend using Sentry. The system automatically captures errors, tracks user actions through breadcrumbs, and provides rich context for debugging.

## Overview

**Service:** Sentry  
**Status:** Production-ready  
**Features:**
- Automatic error capture (runtime, API, wallet, socket)
- Breadcrumb trail for user actions
- User context attached to errors
- Source maps for debugging (minified code → original source)
- Privacy-compliant PII scrubbing
- Performance monitoring
- Session replay (optional)

## Configuration

### Environment Variables

Add the following to your `.env` file:

```bash
# Sentry Configuration (required)
NEXT_PUBLIC_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id

# Optional: CI/CD source map upload
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=your-org
SENTRY_PROJECT=sorotask-frontend

# Optional: Enable debug logging in development
SENTRY_DEBUG=false
```

**Get your DSN:**
1. Create a project at [sentry.io](https://sentry.io)
2. Go to Project Settings → Client Keys (DSN)
3. Copy the DSN URL

### Installation

Dependencies are already added to `frontend/package.json`:

```json
{
  "dependencies": {
    "@sentry/nextjs": "^8.0.0",
    "@sentry/react": "^7.0.0",
    "@sentry/tracing": "^7.0.0"
  }
}
```

Install them:

```bash
cd frontend
npm install
```

## Architecture

### Components

1. **sentry.ts** (`src/lib/errors/sentry.ts`)
   - Core Sentry initialization
   - Privacy filters for PII
   - Helper functions for user context, breadcrumbs, manual capture

2. **tracking.ts** (`src/lib/errors/tracking.ts`)
   - High-level error tracking APIs
   - Breadcrumb management for user actions, navigation, API, wallet, socket
   - Wrapper functions `trackAsync()` and `trackSync()` for automatic error capture

3. **fetchTracker.ts** (`src/lib/errors/fetchTracker.ts`)
   - Wraps `window.fetch` to track all API requests/responses
   - Automatically adds breadcrumbs and captures errors
   - Call `instrumentFetch()` during app initialization

4. **socketTracker.ts** (`src/lib/errors/socketTracker.ts`)
   - Wraps socket.io client to track connection issues
   - Monitors disconnections, reconnection attempts, and event errors

5. **walletTracking.ts** (`src/lib/errors/walletTracking.ts`)
   - Specialized tracking for wallet operations
   - Uses `contractErrors.mapContractError()` to classify errors
   - Tracks connection, transaction signing, network switches

6. **ErrorBoundary.tsx** (`app/components/ErrorBoundary.tsx`)
   - React error boundary component
   - Reports uncaught errors to Sentry with section context

### Data Flow

```
User Action
    ↓
trackUserAction() / trackApiRequest()
    ↓
Sentry.addBreadcrumb()
    ↓ (if error occurs)
Sentry.captureException()
    ↓
Sentry filters PII
    ↓
Event sent to sentry.io
```

## Usage

### Initialize in App Layout

The Sentry configuration is loaded via `sentry.client.config.ts` and `sentry.edge.config.ts`. The `ClientInit` component in `app/layout.tsx` runs fetch instrumentation on mount.

### Set User Context

When a user logs in, call `initializeErrorTracking(userData)`:

```typescript
import { initializeErrorTracking } from '@/src/lib/errors/tracking';

// After successful login
initializeErrorTracking({
  id: user.id,
  walletAddress: user.walletAddress,
  role: user.role,
});
```

On logout:

```typescript
import { clearErrorTracking } from '@/src/lib/errors/tracking';
clearErrorTracking();
```

This attaches the user's ID, role, and masked wallet address to all subsequent error events.

### Track Custom User Actions

```typescript
import { trackUserAction } from '@/src/lib/errors/tracking';

// Track button clicks, menu selections, etc.
trackUserAction('click', 'submit_button', {
  formId: 'task-create',
  page: '/dashboard',
});
```

### Track API Calls

If you're using `fetch`, the global `trackedFetch` wrapper is automatically applied via `instrumentFetch()` in layout.tsx:

```typescript
import { trackedFetch } from '@/src/lib/errors/fetchTracker';

const response = await trackedFetch('/api/tasks', {
  method: 'POST',
  body: JSON.stringify(data),
  trackMetadata: { taskId: '123' },
});
```

For other HTTP clients (axios, etc.), manually track:

```typescript
import { trackApiRequest, trackApiError } from '@/src/lib/errors/tracking';

try {
  trackApiRequest('/api/tasks', 'POST');
  const response = await fetch('/api/tasks', options);
  if (!response.ok) throw new Error('API error');
} catch (error) {
  trackApiError('/api/tasks', 'POST', error);
  throw error;
}
```

### Track Wallet Operations

```typescript
import {
  trackWalletConnectionAttempt,
  trackWalletConnected,
  trackWalletError,
  handleWalletError,
} from '@/src/lib/errors/walletTracking';

try {
  trackWalletConnectionAttempt('testnet');
  const walletAddress = await connectWallet();
  trackWalletConnected(walletAddress);
} catch (error) {
  const { userMessage, category, retryable } = handleWalletError(error);
  // Show userMessage to user, handle retry accordingly
}
```

### Wrap Async Operations

```typescript
import { trackAsync } from '@/src/lib/errors/tracking';

const result = await trackAsync(
  async () => {
    return await someAsyncFunction();
  },
  { operation: 'create_task', taskId: 123, userId: 'abc' }
);
```

### Set Context for Specific Tasks

```typescript
import { setTaskContext, clearTaskContext } from '@/src/lib/errors/tracking';

// When viewing/editing a specific task:
setTaskContext(task.id.toString(), { status: task.status });

// When done:
clearTaskContext();
```

## Error Categories

The system classifies errors into meaningful categories for Sentry grouping and alerting:

### Runtime Errors
- JavaScript exceptions
- Unhandled promise rejections
- Component render errors

### API Errors (`trackApiError`)
- Network failures (timeout, connection refused)
- HTTP errors (4xx, 5xx)
- Invalid responses

### Wallet Errors (`trackWalletError`)
- Wallet not installed
- Wallet locked
- User rejected transaction
- Wrong network
- Insufficient balance/fee
- Transaction sequence errors

### Socket Errors (`trackSocketError`)
- Connection failures
- Unexpected disconnects
- Reconnection failures
- Event delivery errors

### Performance Issues
- Slow API responses (>1s tracked as breadcrumbs)
- Long-running transactions

## Privacy & PII Scrubbing

The Sentry configuration includes a `beforeSend` hook that automatically filters:

**Filtered from event data:**
- Passwords, tokens, secrets
- Authorization headers
- Cookie values
- CSRF tokens
- Credit card numbers
- SSN

**User context sanitization:**
- Never sends raw IP address (if set)
- Wallet addresses are masked (first 10 chars only): `GA32...XYZ9`
- Email addresses, usernames stripped

**Compliance:**
- GDPR Article 25 (data protection by design)
- CCPA compliance
- SOC2-ready (no sensitive leakage)

## Source Maps

Source maps allow debuggers to show original TypeScript source even from minified production bundles.

### Development
Source maps are automatically generated when running `next dev` or `next build`.

### Production Upload (CI/CD)

Source maps should be uploaded to Sentry during deployment:

```bash
# In your CI/CD pipeline after `next build`
npx @sentry/nextjs@latest sourcemaps --org your-org --project sorotask-frontend ./frontend/.next
```

The `SENTRY_AUTH_TOKEN` environment variable is required for upload.

**GitHub Actions Example** (add to existing workflow):
```yaml
- name: Upload source maps to Sentry
  if: env.SENTRY_AUTH_TOKEN != ''
  working-directory: ./frontend
  run: |
    npx @sentry/nextjs@latest sourcemaps \
      --org ${{ secrets.SENTRY_ORG }} \
      --project sorotask-frontend \
      .next
```

## Alerts & Dashboard

### Setting Up Alerts in Sentry

1. **Go to your Sentry project → Alerts**
2. **Create new alert rules:**

**Critical - Unhandled Errors**
- Condition: `event.type:error` AND `level:fatal` OR `level:error`
- Frequency: 1 event in 1 minute
- Notify: Slack, Email, PagerDuty

**Wallet Error Spike**
- Condition: `tags.type:wallet_error`
- Comparison: More than 10 in 10 minutes
- Notify: Slack #dev-alerts

**API Error Rate**
- Condition: `tags.type:api_error`
- Comparison: More than 5% error rate in 5 minutes
- Notify: Slack #api-alerts

**New Error Types**
- Condition: `firstSeen` is within last hour
- Notify: Slack #new-errors

### Error Dashboard

Navigate to **Issues** in Sentry to see:
- All captured errors grouped by fingerprint
- Frequency trends
- User impact (unique users affected)
- Stack traces with source maps
- Breadcrumb timeline
- Session replay (if enabled)

**Recommended Dashboard Filters:**
- `tags.section:` Filter by UI section
- `tags.type:` Filter by error category
- `release:` Filter by deployment version

## Performance Monitoring

Sentry captures performance metrics for:

- Page loads (LCP, FID, CLS)
- API requests (duration, status)
- Custom transactions (use `Sentry.startTransaction()`)

Sample rate:
- Production: 10% of page views
- Development: 100%

Adjust in sentry.client.config.ts:

```typescript
tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
```

## Session Replay (Optional)

Uncomment in sentry.client.config.ts to enable:

```typescript
replaysSessionSampleRate: 0.1,  // 10% of sessions
replaysOnErrorSampleRate: 1.0,  // 100% of error sessions
```

Privacy settings (already configured):
- All text is masked (`maskAllText: true`)
- All media blocked (`blockAllMedia: true`)
- No passwords/credit cards will be captured

## CI/CD Integration

### Before Commit
No pre-commit hooks needed (Sentry client-side only).

### During Build
Source maps are generated automatically by Next.js.

### After Deploy (Optional)
Upload source maps to Sentry for symbolication:

```bash
# Set auth token
export SENTRY_AUTH_TOKEN=your-token

# Upload
npx @sentry/nextjs@latest sourcemaps \
  --org your-org \
  --project sorotask-frontend \
  ./frontend/.next
```

## Debugging

### Local Development

Enable Sentry debug logs:

```bash
# In .env.local
SENTRY_DEBUG=true
```

Check browser console for Sentry logs.

### Testing Error Capture

Use the Errors Demo page: `http://localhost:3000/errors-demo`

It generates synthetic errors to verify Sentry is receiving events.

### Verify in Sentry

1. Open Sentry dashboard
2. Check "Issues" tab - you should see test errors within seconds
3. Click an issue to see:
   - Stack trace (with TypeScript source if source maps uploaded)
   - Breadcrumbs (user actions leading to error)
   - User context
   - Tags (section, environment)

## Tagging & Grouping

Errors are automatically tagged with:

| Tag | Value | Description |
|-----|-------|-------------|
| `section` | From ErrorBoundary props | UI component/section |
| `type` | Manual tag | `wallet_error`, `api_error`, `socket_error`, `auth_error` |
| `endpoint` | URL path | For API errors |
| `operation` | Function name | For tracked async ops |
| `environment` | NODE_ENV | `development`, `staging`, `production` |

Grouping uses `fingerprint` - customize if Sentry groups unrelated errors together:

```typescript
Sentry.withScope((scope) => {
  scope.setFingerprint(['{{ default }}', 'custom-grouping-key']);
  Sentry.captureException(error);
});
```

## Troubleshooting

**No errors appearing in Sentry**
- Verify `NEXT_PUBLIC_SENTRY_DSN` is set and correct
- Check browser console for Sentry init errors
- Ensure `beforeSend` isn't filtering everything
- Check your ad-blocker (some block sentry.io)

**Source maps not working**
- Verify upload succeeded (check Sentry build status)
- Ensure release version matches (`release` is auto-set by Sentry Next.js plugin)
- Check that `.next` directory contains `.map` files

**Sensitive data leaking**
- Check `beforeSend` filter in sentry.ts
- Review `extra` and `tags` fields before capturing
- Test with `SENTRY_DEBUG=true` to log what's being sent

**Performance overhead**
- Breadcrumbs are stored in memory (limited to 100)
- Tracing sample rate can be reduced in production (currently 10%)
- Disable session replay if not needed

## Further Reading

- [Sentry Next.js Docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Sentry Performance](https://docs.sentry.io/product/performance/)
- [Sentry Breadcrumbs](https://docs.sentry.io/platforms/javascript/enriching-events/breadcrumbs/)
- [Sentry Source Maps](https://docs.sentry.io/platforms/javascript/guide/nextjs/upload-source-maps/)
- [Sentry Privacy](https://docs.sentry.io/platforms/javascript/configuration/options/#before-send)
