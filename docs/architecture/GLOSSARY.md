# SoroTask Glossary

This glossary defines domain-specific terms and concepts used throughout the SoroTask platform.

## Core Terms

### Keeper
An off-chain bot that monitors the SoroTask smart contract for due tasks. When a task's execution interval has elapsed and its optional [Resolver](#resolver) condition is met, the Keeper calls the `execute` function on the contract. Keepers are incentivized through execution fees paid out from the task's [Incentive](#incentive) balance.

### Resolver
An optional smart contract that defines custom logic for gating task execution. A Resolver must implement a `check_condition` function that returns a boolean. If a task has a Resolver configured, the SoroTask contract will only execute the task if the Resolver returns `true`. This allows for conditional triggers based on on-chain state (e.g., price feeds, balance thresholds).

### TaskConfig
A core data structure stored on-chain that defines the parameters of an automation task. It includes:
- **Creator**: The address that registered the task.
- **Target**: The contract address to be called.
- **Function**: The specific function name to invoke on the target contract.
- **Arguments**: The parameters to be passed to the target function.
- **Interval**: The minimum number of seconds between executions.
- **Last Run**: A timestamp of the most recent successful execution.
- **Gas Balance**: The amount of tokens held by the task for [Incentive](#incentive) payments.
- **Whitelist**: An optional list of authorized [Keeper](#keeper) addresses.

### Incentive
The mechanism by which [Keepers](#keeper) are rewarded for their work. Each successful task execution deducts a fixed fee from the task's `gas_balance` and transfers it to the Keeper. This ensures that Keepers are compensated for the transaction fees they pay and the computational resources they provide.

---

## Technical Terms

### gas_balance
An internal accounting field within [TaskConfig](#taskconfig) that tracks the amount of tokens available to pay [Keepers](#keeper). Users must deposit tokens into this balance to keep their tasks active.

### check_condition
The specific function interface required for [Resolver](#resolver) contracts. It receives the task's arguments and returns `true` if the task should be executed.

### TaskRegistered
An on-chain event emitted by the SoroTask contract whenever a new task is successfully registered. [Keepers](#keeper) monitor these events to discover new automation opportunities.
