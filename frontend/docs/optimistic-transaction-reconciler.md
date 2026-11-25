# Optimistic Transaction Reconciler

The optimistic transaction reconciler provides a shared state machine for frontend flows that update task state before the network or API has confirmed the transaction.

## States

- `optimistic`: local UI state has been applied and is waiting for confirmation.
- `confirmed`: server or on-chain confirmation matched the tracked task, operation, and transaction hash.
- `rolled_back`: confirmation failed and the caller should restore the rollback payload.
- `conflict`: confirmation arrived, but authoritative fields listed in `compareKeys` did not match the optimistic payload.
- `stale`: no confirmation arrived before the reconciliation window expired.

## Matching Rules

Confirmations are accepted only when they match the tracked `taskId` and `operation`. If both sides provide a transaction hash, the hashes must also match. Payload conflict checks are opt-in through `compareKeys`; transient UI fields such as `pending` status should not be treated as authoritative by default.

## Security Review

Confirmation data is treated as untrusted input. The reconciler does not execute payload content, does not fetch remote data, and does not expose raw sensitive fields in audit events. Keys that resemble secrets, credentials, tokens, signatures, private data, or XDR are redacted before audit output is returned to UI surfaces.

`conflict` and `stale` states should be shown to users as review or retry states. They should not silently overwrite local task state because they indicate either a mismatch with authoritative data or a missing confirmation.

## Integration

Use `createOptimisticTransaction` when applying local state. Call `reconcileOptimisticTransactions` when server or on-chain confirmations arrive. React surfaces can use `useOptimisticTxReconciler` and render `OptimisticTxReconcilerPanel` to display state counts, tracked transactions, and redacted audit details.
