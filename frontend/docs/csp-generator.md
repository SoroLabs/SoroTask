# Content Security Policy (CSP) Dynamic Generator

## Purpose
To mitigate cross-site scripting (XSS) and data injection attacks by programmatically constructing and enforcing a Content Security Policy that dynamically adapts to different deployment and development environments.

## Key Features
- **Dictionary-Based Directives**: Configures core browser resource restrictions including `default-src 'self'`, `object-src 'none'`, and `upgrade-insecure-requests`.
- **Cryptographic Nonces**: Facilitates strict-dynamic policy paths by embedding secure nonces into the script directives to support safe inline scripts.
- **Environment-Aware Overrides**: Automatically allows `'unsafe-eval'` and `'unsafe-inline'` when running in local development mode to preserve module reloading features.
- **Observability Reporting**: Configures `report-uri` forwarding to capture and track blocking events across live client environments.
- **Custom Extensibility**: Merges and deduplicates additional path and domain rules passed via `extraDirectives`.

## File Location
- Implementation: `frontend/lib/csp-generator.ts`
- Test Suite: `frontend/lib/__tests__/csp-generator.test.ts`

## Complexity Analysis
- **Time Complexity**: $O(D + E)$ where $D$ is the number of default directives and $E$ is the number of custom merged directives.
- **Space Complexity**: $O(D + E)$ to allocate string arrays and join the directive rules into a single response header value.
