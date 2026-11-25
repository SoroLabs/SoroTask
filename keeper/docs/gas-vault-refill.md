# Automated gas vault refill (Issue #787)

Swaps earned stablecoin bounties (USDC/USDT/etc.) to XLM via a
Soroswap-compatible router when the keeper's native balance runs low, so a
keeper paid in stablecoins doesn't eventually run out of transaction fees.

Implemented in `src/gasVaultRefill.js` (`GasVaultRefillMonitor`).

## Wiring it in

Balances are injected, not fetched by this module directly — see the
"why" in the file's own header comment (there's no single balance-reading
mechanism that's correct across every SoroTask deployment). Wire it up
something like:

```js
const { GasVaultRefillMonitor } = require('./src/gasVaultRefill');

const gasVaultRefill = new GasVaultRefillMonitor({
  server,
  keypair,
  getXlmBalance: async () => { /* your account's native balance, in XLM */ },
  getSourceAssetBalance: async (contractId) => { /* trustline balance for `contractId` */ },
  routerContractId: config.gasVaultRefill.routerContractId,
  xlmContractId: config.gasVaultRefill.xlmContractId,
  sourceAssetContractIds: config.gasVaultRefill.sourceAssetContractIds,
  triggerThresholdXlm: config.gasVaultRefill.triggerThresholdXlm,
  targetBalanceXlm: config.gasVaultRefill.targetBalanceXlm,
  maxSlippage: config.gasVaultRefill.maxSlippage,
  cooldownMs: config.gasVaultRefill.cooldownMs,
  checkIntervalMs: config.gasVaultRefill.checkIntervalMs,
  logger: createLogger('gas-vault-refill'),
  metrics: metricsServer,
});

if (config.gasVaultRefill.enabled) {
  gasVaultRefill.start();
}
```

Not wired into `index.js` automatically in this change — the balance
getters above are deployment-specific, so the safest thing is to plug
them in deliberately rather than guess.

## Configuration

| Env var | Default | |
|---|---|---|
| `GAS_VAULT_REFILL_ENABLED` | `false` | Must be `true` to run any swap |
| `GAS_VAULT_REFILL_TRIGGER_XLM` | `30` | Swap when XLM balance falls below this |
| `GAS_VAULT_REFILL_TARGET_XLM` | `100` | Swap enough to reach roughly this balance |
| `GAS_VAULT_REFILL_ROUTER_CONTRACT_ID` | — | Soroswap-compatible router contract ID |
| `GAS_VAULT_REFILL_SOURCE_ASSETS` | — | Comma-separated source-asset SAC contract IDs, priority order |
| `GAS_VAULT_REFILL_XLM_CONTRACT_ID` | — | Native XLM SAC contract ID |
| `GAS_VAULT_REFILL_MAX_SLIPPAGE` | `0.01` | Max acceptable slippage fraction |
| `GAS_VAULT_REFILL_COOLDOWN_MS` | `600000` | Min time between swap attempts |
| `GAS_VAULT_REFILL_CHECK_INTERVAL_MS` | `60000` | How often to check |

## How a swap works

Calls the configured router's `swap_exact_tokens_for_tokens(amount_in,
amount_out_min, path, to, deadline)` — the standard Soroswap-style
router interface (Uniswap-V2-shaped) — with `path` set to
`[sourceAsset, xlm]`, `amount_in` the full available source-asset
balance, `amount_out_min` computed from `targetBalanceXlm` minus the
current XLM balance, adjusted for `maxSlippage`, and a 5-minute deadline.
Builds, simulates, signs (with the keeper's own keypair), and submits the
transaction the same way `executor.js` does for task execution.

On failure for one source asset, the monitor tries the next configured
one before giving up for that check cycle. A `cooldownMs` window after
any submitted swap (successful or not) prevents repeated attempts while
a swap is still settling.

## Verify before enabling in production

The router interface assumed here (`swap_exact_tokens_for_tokens`) matches
Soroswap's publicly documented router contract. **Verify this against the
actual router contract you configure** — if you're pointing at a
different DEX/router with a different entrypoint name or argument order,
update `_executeSwap` accordingly before enabling
`GAS_VAULT_REFILL_ENABLED` against real funds.
