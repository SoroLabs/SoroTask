# SoroTask Terminal

The developer terminal is available at `/sandbox`. It provides a constrained
task command interface; it never evaluates JavaScript, invokes a shell, or
accepts arbitrary executable names. Task reads and mutations use the same
mock task API and query hooks as the task UI.

## Commands

```text
sorotask help
sorotask list [--status pending|running|success|failed]
sorotask create --contract ADDRESS --fn NAME --interval SECONDS --gas UNITS
sorotask update --id ID [--interval SECONDS] [--gas UNITS]
sorotask delete --id ID
sorotask simulate --contract ADDRESS --fn NAME
```

Positive numeric values are required for intervals and gas. Updates must
include at least one of those fields. `simulate` requires a connected wallet
and simulates a zero-argument call against the wallet's selected Soroban RPC;
it does not sign or submit a transaction.

List output supports `grep` and JSON formatting pipes:

```text
sorotask list | grep harvest
sorotask list | json
```

Use Tab for command completion, Up/Down to navigate command history, and
Ctrl+` to open or close the terminal. The command engine intentionally
supports only the documented operations and pipe filters.
