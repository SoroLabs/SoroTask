# Keeper HSM-backed Security Stack

This module provides a pluggable HSM/KMS-backed key management and delegated permissions system for the Keeper.

Components
- `src/hsm/provider.js` — HSM provider abstraction (interface)
- `src/hsm/mockProvider.js` — In-process mock HSM (for development)
- `src/keyManager.js` — Key lifecycle: create, rotate, activate, deactivate, list
- `src/permissions.js` — Delegated permissions engine: grants, revocation, expiration
- `src/signingService.js` — Secure signing workflow enforcing permissions and using HSM
- `src/auditLog.js` — Immutable append-only audit log with chained hashes
- `src/observability.js` — Prometheus counters and metrics registry
- `src/keeperSecurity.js` — Factory to build the security stack

Quick start

1. Build the stack in your Keeper initialization:

```
const { buildSecurityStack } = require('./src/keeperSecurity');
const stack = buildSecurityStack({ auditFile: '/var/lib/keeper/audit.log' });
// stack.signing.sign({ requester: 'alice', keyId: 'k1', payload: '...'} )
```

Production HSM

Replace the `MockHSMProvider` with a production HSM/KMS implementation that implements the `HSMProvider` methods and ensures private keys never leave the HSM.

Testing

Run tests in `keeper`:

```
cd keeper
npm install
npm test
```

Security notes
- Private key material is only stored inside the HSM provider implementation.
- Audit log uses chained SHA-256 hashes to provide tamper-evidence.
- Permissions are least-privilege by default: grants must explicitly cover subject, resource, action, and scope.
