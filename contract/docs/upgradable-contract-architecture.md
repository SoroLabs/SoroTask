# Upgradable Contract Architecture

SoroTask now supports a Soroban-native transparent proxy architecture. Soroban
does not use EVM-style `delegatecall`; instead, a contract instance keeps the
same contract ID and state while its executable WASM hash is replaced through
`Env::deployer().update_current_contract_wasm`.

## Goals

- Keep the SoroTask contract ID stable across logic upgrades.
- Preserve task, dependency, gas, portfolio, and governance state in existing
  instance and persistent storage.
- Restrict upgrades to an authenticated proxy admin.
- Require monotonic versioning so stale governance transactions cannot replace
  newer logic.
- Emit upgrade events and store audit records for off-chain indexers.

## Storage Model

The upgrade control plane uses instance storage:

| Key | Purpose |
| --- | --- |
| `DataKey::ProxyConfig` | Current proxy admin, semantic logic version, latest implementation hash, and upgrade count. |
| `DataKey::UpgradeRecord(id)` | Immutable audit record for each accepted upgrade request. |
| `DataKey::AdminAddress` | Mirrors the proxy admin for existing admin-aware integrations. |
| `DataKey::Token` | Existing gas token configuration, initialized through `init_proxy`. |

Task and platform state continue to live under the existing keys such as
`Task(id)`, `Counter`, `TaskDependencies(id)`, `Portfolio(id)`, and related
storage records.

## Public Upgrade API

### `init_proxy(admin, token, version)`

Initializes the token and upgrade layer in a single call. The `admin` address
must authorize the call. `version` must be greater than zero.

Use this for new deployments that need upgradeability from day one. The legacy
`init(token)` function remains available for backward compatibility but does
not enable upgrades.

### `upgrade_contract(admin, new_wasm_hash, expected_version, new_version)`

Upgrades the current contract instance to a previously uploaded Soroban WASM
hash.

Checks:

- `admin` must authorize the call.
- `admin` must equal the current `ProxyConfig.admin`.
- `expected_version` must equal the stored version.
- `new_version` must be greater than the stored version.
- `new_wasm_hash` must already exist in the ledger, enforced by Soroban when
  `update_current_contract_wasm` runs.

On success, the contract writes an `UpgradeRecord`, updates `ProxyConfig`, emits
`ContractUpgraded`, and asks Soroban to replace the current contract WASM.

### `transfer_proxy_admin(admin, new_admin)`

Transfers upgrade authority. The current admin must authorize the call. This is
intended for moving control to a multisig, DAO executor, or timelock contract.

### Read APIs

- `get_proxy_config()`
- `get_proxy_admin()`
- `get_contract_version()`
- `get_upgrade_record(upgrade_id)`

## Deployment Flow

1. Deploy the initial SoroTask WASM.
2. Call `init_proxy(admin, token, 1)`.
3. Transfer admin authority to a governance-controlled address if needed.
4. For each upgrade:
   - Build and review the replacement WASM.
   - Upload the WASM and capture its hash.
   - Simulate `upgrade_contract(admin, hash, current_version, next_version)`.
   - Execute the upgrade transaction.
   - Verify `get_contract_version()` and `get_upgrade_record(id)`.

## Security Review Notes

- Upgrade authority is explicit and authenticated with `Address::require_auth`.
- Version checks prevent replaying old upgrade transactions after a newer
  upgrade has landed.
- Upgrade state is updated in the same transaction as the WASM replacement; if
  Soroban rejects the hash, the transaction reverts.
- The stable contract ID preserves storage, so replacement implementations must
  keep existing `DataKey` variants and contract types backward compatible.
- The legacy `init(token)` path intentionally leaves the upgrade layer disabled.
  Existing deployments should not be silently claimed by a new admin without a
  separate migration plan.

## Compatibility Rules For Future Implementations

- Do not rename or reorder existing `DataKey` variants unless a migration is
  shipped and tested.
- Do not change serialized shapes of persisted structs without a migration.
- Keep `ProxyConfig` and `UpgradeRecord` readable across versions.
- Keep `upgrade_contract` and `transfer_proxy_admin` admin-only.
- Add regression tests proving task state survives any migration logic.
