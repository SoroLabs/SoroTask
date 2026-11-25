# Creating a Resolver Contract

Resolver contracts let a SoroTask task run only when custom on-chain logic says
it is ready. They are useful when a fixed interval is not enough, such as
"rebalance after 09:00 UTC" or "top up when a vault balance drops below a
threshold."

In this tutorial you will build a small resolver, deploy it, and link it to a
task.

## What a resolver must implement

SoroTask calls the resolver before it invokes the task target. The resolver must
expose this function:

```rust
pub fn check_condition(env: Env, args: Vec<Val>) -> bool
```

SoroTask passes the task's `args` vector into `check_condition` as one argument.
If the resolver returns `true`, the task can continue to the target call. If it
returns `false`, panics, or fails, SoroTask skips execution for that attempt.

The normal execution order is:

1. The keeper calls `execute(task_id)`.
2. SoroTask checks the task interval, pause state, dependencies, and keeper
   permissions.
3. If the task has a resolver, SoroTask calls
   `resolver.check_condition(args)`.
4. SoroTask calls the target contract only when the resolver returns `true`.

## Step 1: Create a resolver crate

Create a Soroban contract crate next to your target contract:

```bash
cargo new --lib time-window-resolver
cd time-window-resolver
```

Add the Soroban SDK to `Cargo.toml`:

```toml
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
soroban-sdk = { version = "26.0.1", default-features = false }

[features]
testutils = ["soroban-sdk/testutils"]
```

## Step 2: Write a time-based resolver

This resolver allows execution only after a configured Unix timestamp. It reads
the timestamp from the first task argument, which keeps the resolver reusable
for many tasks.

```rust
#![no_std]

use soroban_sdk::{contract, contractimpl, Env, TryFromVal, Val, Vec};

#[contract]
pub struct TimeWindowResolver;

#[contractimpl]
impl TimeWindowResolver {
    pub fn check_condition(env: Env, args: Vec<Val>) -> bool {
        let Some(not_before_value) = args.get(0) else {
            return false;
        };

        let Ok(not_before) = u64::try_from_val(&env, &not_before_value) else {
            return false;
        };

        env.ledger().timestamp() >= not_before
    }
}
```

When you register the task, pass the `not_before` timestamp in the task args.
The same args are later forwarded to the target contract, so make sure the
target function also expects them or can safely ignore them.

## Alternative: Balance-based resolver

A balance-based resolver is useful for top-up or liquidation workflows. This
example stores a token, watched account, and minimum balance during
initialization, then approves execution only when the watched account falls
below the threshold.

```rust
#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Val, Vec,
};

#[contracttype]
enum DataKey {
    Token,
    WatchedAccount,
    MinimumBalance,
}

#[contract]
pub struct BalanceThresholdResolver;

#[contractimpl]
impl BalanceThresholdResolver {
    pub fn init(
        env: Env,
        token_address: Address,
        watched_account: Address,
        minimum_balance: i128,
    ) {
        env.storage().instance().set(&DataKey::Token, &token_address);
        env.storage()
            .instance()
            .set(&DataKey::WatchedAccount, &watched_account);
        env.storage()
            .instance()
            .set(&DataKey::MinimumBalance, &minimum_balance);
    }

    pub fn check_condition(env: Env, _args: Vec<Val>) -> bool {
        let Some(token_address) = env.storage().instance().get::<_, Address>(&DataKey::Token)
        else {
            return false;
        };
        let Some(watched_account) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::WatchedAccount)
        else {
            return false;
        };
        let Some(minimum_balance) = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::MinimumBalance)
        else {
            return false;
        };

        let token_client = token::Client::new(&env, &token_address);
        token_client.balance(&watched_account) < minimum_balance
    }
}
```

Use this form when the condition should be configured once at deploy time rather
than passed through every task's args.

## Step 3: Build and deploy the resolver

Build the resolver WASM:

```bash
cargo build --target wasm32-unknown-unknown --release
```

Deploy it to the same network as your SoroTask contract:

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/time_window_resolver.wasm \
  --source alice \
  --network testnet
```

Save the deployed resolver contract ID. You will use it as the task's
`resolver` address.

If you use the balance-based resolver, initialize it after deployment:

```bash
stellar contract invoke \
  --id "$RESOLVER_ID" \
  --source alice \
  --network testnet \
  -- init \
  --token_address "$TOKEN_ID" \
  --watched_account "$WATCHED_ACCOUNT" \
  --minimum_balance 100000000
```

## Step 4: Link the resolver to a task

When registering a task, set `TaskConfig.resolver` to the deployed resolver
address instead of `None` or `null`.

Rust test setup:

```rust
use soroban_sdk::{Address, Env, IntoVal, Symbol, Val, Vec};
use soro_task_contract::{SoroTaskContract, SoroTaskContractClient, TaskConfig};
use time_window_resolver::TimeWindowResolver;

let env = Env::default();
let sorotask_id = env.register(SoroTaskContract, ());
let resolver_id = env.register(TimeWindowResolver, ());

let creator = Address::generate(&env);
let target = Address::generate(&env);
let not_before = env.ledger().timestamp() + 3_600;

let mut args = Vec::<Val>::new(&env);
args.push_back(not_before.into_val(&env));

let config = TaskConfig {
    creator,
    target,
    function: Symbol::new(&env, "rebalance"),
    args,
    resolver: Some(resolver_id),
    interval: 300,
    last_run: 0,
    gas_balance: 1_000,
    whitelist: Vec::new(&env),
    is_active: true,
    blocked_by: Vec::new(&env),
    yield_strategy: None,
};

let client = SoroTaskContractClient::new(&env, &sorotask_id);
let task_id = client.register(&config);
```

JavaScript client setup:

```javascript
await client.register({
  creator: source.publicKey(),
  target: TARGET_CONTRACT_ID,
  function: "rebalance",
  args: [notBeforeTimestamp],
  resolver: RESOLVER_CONTRACT_ID,
  interval: 300,
  last_run: 0,
  gas_balance: 1000,
  whitelist: [],
  is_active: true,
  blocked_by: [],
  yield_strategy: null
});
```

For a balance-based resolver, keep `args` aligned with the target function and
still set `resolver: RESOLVER_CONTRACT_ID`. The resolver reads its condition
from its own storage, so it does not need any resolver-specific task args.

## Step 5: Test both branches

Resolver tests should prove that SoroTask behaves correctly when the resolver
allows and denies execution:

```rust
#[test]
fn time_resolver_blocks_before_timestamp() {
    let env = Env::default();
    let resolver_id = env.register(TimeWindowResolver, ());
    let resolver = TimeWindowResolverClient::new(&env, &resolver_id);

    let mut args = Vec::<Val>::new(&env);
    args.push_back((env.ledger().timestamp() + 60).into_val(&env));

    assert_eq!(resolver.check_condition(&args), false);
}

#[test]
fn time_resolver_allows_after_timestamp() {
    let env = Env::default();
    let resolver_id = env.register(TimeWindowResolver, ());
    let resolver = TimeWindowResolverClient::new(&env, &resolver_id);

    let mut args = Vec::<Val>::new(&env);
    args.push_back(env.ledger().timestamp().into_val(&env));

    assert_eq!(resolver.check_condition(&args), true);
}
```

Also test the SoroTask integration:

- Register one task with `resolver: Some(resolver_id)`.
- Execute before the condition is true and assert the target is not called.
- Advance the ledger timestamp or update the watched balance.
- Execute again and assert the target is called and `last_run` is updated.
- Add a panicking or malformed resolver test and confirm execution is skipped.

## Safety checklist

- Keep resolver logic small and deterministic.
- Return `false` for missing or malformed args.
- Do not use a resolver that can be upgraded without review.
- Keep resolver state on the same network as the SoroTask contract.
- Remember that SoroTask still enforces interval, pause, dependency, whitelist,
  and gas checks around the resolver gate.
