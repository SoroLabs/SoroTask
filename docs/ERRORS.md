# Smart Contract Error Codes

This document lists every `Error` enum variant exposed by the SoroTask smart contract. Frontend clients can use the numeric contract error code to display a stable, human-readable message.

Source: `contract/src/lib.rs` (`#[contracterror] pub enum Error`).

## Error Reference

| Code | Variant                       | Explanation                                                                                                                                                                                  |
| ---- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `InvalidInterval`             | A supplied interval, batch size, fee, or other numeric threshold is outside the allowed range. Common examples include registering a task with a zero interval or submitting an empty batch. |
| 2    | `Unauthorized`                | The caller is not allowed to perform the requested action. This is used for creator/admin checks, keeper whitelist checks, and oracle fulfillment authorization.                             |
| 3    | `InsufficientBalance`         | The task or account does not have enough balance for the requested operation, such as execution gas accounting, deposits, withdrawals, or protocol fee checks.                               |
| 4    | `NotInitialized`              | Required contract setup is missing before the action can proceed, such as attempting an admin-only configuration before the admin has been initialized.                                      |
| 5    | `TaskPaused`                  | The task is paused and cannot be executed until it is resumed.                                                                                                                               |
| 6    | `TaskAlreadyPaused`           | The caller attempted to pause a task that is already paused.                                                                                                                                 |
| 7    | `TaskAlreadyActive`           | The caller attempted to resume a task that is already active.                                                                                                                                |
| 8    | `SelfDependency`              | A task cannot depend on itself.                                                                                                                                                              |
| 9    | `DependencyNotFound`          | A referenced dependency task does not exist or the requested dependency relationship cannot be found.                                                                                        |
| 10   | `CircularDependency`          | Adding the dependency would create a circular dependency chain.                                                                                                                              |
| 11   | `DependencyBlocked`           | The task cannot execute because one or more dependency tasks have not completed yet.                                                                                                         |
| 12   | `AlreadyInitialized`          | A one-time initialization function was called after the relevant contract state had already been initialized.                                                                                |
| 13   | `UnauthorizedSlasher`         | The caller is not the configured operator allowed to perform slashing-related actions.                                                                                                       |
| 14   | `KeeperStakeTooLow`           | The keeper's stake is below the minimum required amount. This variant is defined for keeper staking and slashing flows.                                                                      |
| 15   | `OperatorAlreadySet`          | An operator has already been configured. This variant is defined for operator setup flows that should only run once.                                                                         |
| 16   | `InvalidPayload`              | A governance or configuration payload is malformed or too short to decode safely.                                                                                                            |
| 17   | `ReentrantCall`               | A protected function was entered while another protected call was still active. Frontends should treat this as a rejected unsafe nested call.                                                |
| 18   | `DependencyLimitExceeded`     | The task already has the maximum number of dependencies allowed by the contract.                                                                                                             |
| 19   | `DependencyDepthExceeded`     | The dependency graph exceeds the maximum supported depth.                                                                                                                                    |
| 20   | `VrfOracleNotSet`             | A VRF randomness request was attempted before a VRF oracle address was configured.                                                                                                           |
| 21   | `InvalidVrfRequest`           | The VRF or proof request is invalid, such as an empty callback function or an empty proof.                                                                                                   |
| 22   | `VrfRequestFailed`            | The VRF request could not be found, contained invalid randomness, or had invalid proof data.                                                                                                 |
| 23   | `VrfAlreadyFulfilled`         | The VRF request is no longer pending and cannot be fulfilled again.                                                                                                                          |
| 24   | `YieldStrategyNotInitialized` | The selected yield strategy is missing or inactive, so the yield-enabled task cannot execute it.                                                                                             |
| 25   | `InvalidYieldStrategy`        | A yield strategy configuration is invalid. This variant is defined for yield strategy validation flows.                                                                                      |
| 26   | `YieldHarvestFailed`          | A yield harvest operation failed. This variant is defined for yield strategy execution flows.                                                                                                |
| 27   | `InsufficientYield`           | The available yield is below the minimum threshold for harvesting or compounding. This variant is defined for yield strategy flows.                                                          |
| 28   | `OracleNotSet`                | The requested oracle provider has not been configured or is inactive.                                                                                                                        |
| 29   | `OracleRequestFailed`         | An oracle request failed before it could be fulfilled. This variant is defined for oracle retry/failure flows.                                                                               |
| 30   | `OracleInvalidResponse`       | The oracle response is invalid for the current request state, such as fulfilling a request that is not pending.                                                                              |
| 31   | `OracleTimeout`               | An oracle request timed out before a valid response was received. This variant is defined for oracle timeout handling.                                                                       |
| 32   | `OracleUnsupportedProvider`   | The requested oracle provider is not supported by the contract. This variant is defined for provider validation flows.                                                                       |
| 33   | `InvalidInsurancePolicy`      | An insurance policy action is invalid, such as creating a policy with non-positive premium or coverage, submitting a claim on a non-active policy, or settling a non-submitted claim.        |
| 34   | `ArgsTooMany`                 | The supplied argument vector exceeds the contract's maximum allowed argument count.                                                                                                          |
| 35   | `ArgsTooLarge`                | The supplied argument payload or proof data exceeds the contract's maximum allowed size.                                                                                                     |
| 36   | `TaskNotFound`                | The requested task ID does not exist.                                                                                                                                                        |
| 37   | `InvalidUpgradeVersion`       | The requested upgrade version is invalid, stale, or not greater than the current contract version.                                                                                           |

## Frontend Handling Notes

- Treat the numeric code as the stable lookup key returned by Soroban contract errors.
- Codes are assigned explicitly in the Rust enum; do not infer codes from declaration order.
- Variants marked as "defined for" may not be emitted by the current code path yet, but they are part of the contract error enum and should still be handled gracefully.
