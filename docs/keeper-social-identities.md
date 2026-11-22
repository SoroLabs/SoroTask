# Verified keeper social profiles

The `/keepers` leaderboard can display GitHub, Farcaster and Lens ownership
badges next to a Stellar keeper address. Before this change it displayed only
keeper metrics and addresses. After a successful link, a row includes, for
example, `✓ GitHub: synthetic-keeper`; its accessible link label says
`GitHub synthetic-keeper, ownership verified, opens in a new tab`.

These badges prove profile and keeper-key ownership at the displayed verification
time. They do not endorse the keeper's reliability, verify its reported metrics,
or grant permissions to execute tasks. Existing authentication normalization and
keeper/delegation behavior remain compatible.

## Link and unlink

1. Sign in to SoroTask and connect the keeper account in Freighter.
2. Select a provider. For GitHub, sign in through GitHub OAuth; a supplied username
   or legacy mock OAuth result cannot create a badge. For Farcaster, enter a
   numeric FID. For Lens, enter the Lens account's EVM address.
3. Select **Verify and link**. Farcaster and Lens additionally require an
   Ethereum-compatible browser wallet to sign with the provider-resolved owner.
4. Inspect and sign the human-readable request, then confirm it in Freighter.
   The server verifies both proofs before storing a link. Declining a prompt
   cancels the operation without automatic retries or completion submission.
5. Use **Unlink github/farcaster/lens** to remove a link with a new keeper-signed
   unlink request. Unlink does not require the former social account or provider
   to remain available.

The signing request binds the action, canonical origin, network passphrase,
Stellar account, provider account, resolved owner, nonce and timestamps. Stellar
proofs follow [SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md):
Ed25519 over SHA-256 of `Stellar Signed Message:\n` plus the UTF-8 request.
EVM owner proofs use EIP-191 `personal_sign`, with canonical low-S signatures.
Freighter's reported signer and active account must match the connected keeper.
The default network matches the existing frontend's Futurenet wallet policy.

Challenges expire after five minutes and are consumed once, including an invalid
completion attempt. Provider ownership is checked again during completion;
changed owners and requests that expire during that check are rejected. At most
five challenges per signed-in subject may be pending. A provider account can have
one active keeper link; the same wallet may replace its link for that provider.
Badges expire after 30 days and require a new proof to renew. Ownership is not
continuously monitored between verifications. Expired badges, wrong-wallet
responses and unexpected profile URLs are filtered before rendering.

No transaction, payment, market publishing, private-key upload, or signing
authority change is involved. The existing Stellar account key proves control;
custom multisig/delegated signing and hardware devices without message signing
support are not covered by this interface.

## Deployment configuration

| Variable | Purpose |
| --- | --- |
| `AUTH_URL` (or `NEXTAUTH_URL`) | Canonical application origin; HTTPS is required in production. Host/forwarded headers cannot override it. |
| `AUTH_SECRET` (or `NEXTAUTH_SECRET`) | Existing Auth.js session secret. |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth application credentials; the existing `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` aliases also work. |
| `NEYNAR_API_KEY` | Server-only Farcaster lookup key. Without it Farcaster is unavailable. |
| `KEEPER_IDENTITY_STATE_DIR` | Private, persistent directory shared by Node workers on one host; defaults to `.keeper-identities` under the frontend working directory. |

Register the existing `/api/auth/callback/github` OAuth callback for the canonical
origin. Set real credentials only in the deployment's secret/environment store.
Lens reads `https://api.lens.xyz/graphql`; Farcaster reads the fixed Neynar bulk
user endpoint. Inputs cannot select arbitrary network URLs. Fetches reject
redirects, time out after eight seconds, and cap responses at 64 KiB.

The file store creates a private directory and mode-0600 records, serializes
workers with an exclusive lock, validates stored records and atomically replaces
synced state files. It stores public links and short-lived challenge/session
identifiers; it does not store OAuth tokens, API keys, wallet secrets or submitted
signatures. Runtime state is ignored by Git. Keep the directory private, trusted
and backed up; the API returns no storage paths or provider response details.

This store requires persistent local disk with reliable exclusive-create/rename
semantics. Do not enable it on ephemeral serverless storage, separate hosts with
independent disks, or unreliable network filesystems. Such deployments must
provide an `IdentityStore` with equivalent transaction/replay guarantees backed
by their shared database. Limits are 2,000 pending challenges, 5,000 active links
and 4 MiB state. Expired challenges/links are pruned during the corresponding
write operations.

If a process crashes while holding `identity.lock`, writes fail closed with
`storage_busy`. Stop **all** workers using this directory, confirm none can still
hold the lock, remove that lock file only, and restart. Do not remove a live lock
or overwrite corrupt state. Investigate `storage_invalid` and restore a trusted
backup before resuming linking. This deliberate recovery rule prevents unsafe
time-based lock takeover.

## API and stable errors

Authenticated `GET /api/auth/keeper-identities?address=<Stellar-address>` returns
`identities` keyed by wallet address, the caller's trusted GitHub profile (or
`null`) and provider availability. Repeat `address` up to 100 times. Keeper metrics
cannot supply verified badges; identity-service failure clears them while
retaining the metrics table.

Same-origin JSON `POST` requests are limited to 8 KiB while streaming. To request
a proof, send `{ operation: "challenge", action: "link" | "unlink", provider,
identifier, walletAddress }`; the response contains `challenge`. Complete with
`{ operation: "complete", nonce, walletSignature, ownerSignature? }`; the response
contains the verified `identity`, or `null` after unlink. `walletSignature` is a
base64-encoded 64-byte SEP-53 signature; `ownerSignature` is a 65-byte hexadecimal
EIP-191 signature. The browser adapter normalizes supported Freighter encodings.
Responses use `Cache-Control: no-store`. Error bodies contain only
`{ "error": { "code": "..." } }`.

| Code | HTTP | Recovery |
| --- | --- | --- |
| `sign_in_required`, `github_sign_in_required` | 401 | Sign in with the required provider. |
| `origin_mismatch` | 403 | Use the configured application origin. |
| `invalid_request`, `invalid_wallet`, `invalid_profile` | 400 | Correct the request, wallet or provider identifier. |
| `request_too_large` | 413 | Reduce the JSON body to 8 KiB. |
| `invalid_challenge`, `challenge_expired` | 400 | Start a new signing request. |
| `invalid_wallet_signature`, `invalid_owner_signature`, `profile_owner_changed` | 400 | Select the correct owner accounts and start again. |
| `profile_not_found`, `identity_not_linked` | 404 | Check the profile or refresh the link list. |
| `profile_already_linked` | 409 | Unlink from the previous keeper before linking here. |
| `too_many_challenges` | 429 | Wait five minutes for pending requests to expire. |
| `provider_not_configured`, `identity_not_configured` | 503 | The operator must configure the provider/service. |
| `provider_unavailable`, `identity_unavailable` | 503 | Retry later; operators should investigate persistent failures. |
| `storage_busy`, `storage_unavailable`, `storage_invalid`, `storage_capacity` | 503 | Retry transient contention; ask the operator to repair storage or capacity. |

The UI explains failures without echoing signatures, keys, raw provider responses
or a different keeper's identity. New Noble dependencies verify/recover EIP-191
secp256k1 ownership using Keccak; Stellar signing uses the existing Stellar SDK.
Dependency versions are pinned and require no installation hooks.

## Focused verification

All fixtures are synthetic. Tests sign with temporary/random keys and use fake
provider transports and temporary state directories, without live credentials.

```sh
cd frontend
npm test -- --runInBand --runTestsByPath \
  src/lib/auth/__tests__/keeper-identities.test.ts \
  src/lib/auth/__tests__/identity-wallet.test.ts \
  src/components/__tests__/keeper-identities.test.tsx \
  app/api/auth/keeper-identities/route.test.ts \
  'app/api/auth/[...nextauth]/route.test.ts' \
  app/keepers/page.test.tsx \
  src/lib/auth/__tests__/IdentityManager.test.ts \
  src/lib/auth/__tests__/AuthPipeline.test.ts
npm run lint
npm run build
```
