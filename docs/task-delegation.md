# Task delegation / ACL (Issue #778)

A task's `permissions: u32` bitmask field already existed on `TaskConfig`
(`PERM_CAN_PAUSE`, `PERM_CAN_UPDATE`, `PERM_CAN_CANCEL`,
`PERM_CAN_DEPOSIT`), but every entry point that checked it
(`pause_task_internal` and friends) only ever accepted `config.creator`'s
signature — the bitmask was checked, but always against the same address
that had just authenticated, so it could only ever be used by a creator
to restrict their own actions, never to actually delegate access to a
teammate or operator script.

## What was added

- `DataKey::TaskDelegate(task_id, delegate_address) -> u32`: a per-task,
  per-address permission bitmask, separate from `TaskConfig` itself (so
  existing persisted tasks' XDR shape is untouched — adding a field
  directly to `TaskConfig` would break decoding every already-registered
  task).
- `set_task_delegate(task_id, delegate, permissions)` / `revoke_task_delegate(task_id, delegate)`
  — creator-only, grant/revoke a delegate's bitmask. `permissions = 0` via
  `set_task_delegate` is equivalent to `revoke_task_delegate`.
- `pause_task_as(task_id, caller)` — a new entry point usable by either
  the creator or a delegate holding `PERM_CAN_PAUSE`.

## Why a new entry point instead of changing `pause_task`

Soroban has no implicit caller identity (no `msg.sender`) — authorization
only exists as `some_address.require_auth()`, so delegated access needs
an *explicit* caller parameter. Adding one to the existing `pause_task(task_id)`
would be a breaking signature change for every already-integrated caller
(the keeper, tests, any SDK). `pause_task_as(task_id, caller)` is
additive: `pause_task` is untouched and remains creator-only.

## What's not implemented yet

Only `pause_task_as` was added. `modify_task`, `cancel_task`, and
`deposit_gas` would follow the exact same pattern (check
`caller == creator`, else look up `DataKey::TaskDelegate(task_id, caller)`
and check the corresponding `PERM_CAN_*` bit) — left as a follow-up
rather than making several more entry-point changes to an already very
large contract file in one pass without being able to compile-check any
of them.
