# Cross-chain State Proof Verifier

The cross-chain task manager includes a local state proof verifier for relayer proof packages. The verifier compares pasted proof JSON against the loaded task registry, the source chain confirmation status, and the bridge event log before the UI treats a proof as acceptable.

## Proof Shape

The verifier expects JSON with these fields:

- `proofId`
- `taskId`
- `sourceNetwork`
- `targetNetwork`
- `sourceTxHash`
- `stateRoot`
- `bridgeEventId`
- `observedAt`

Optional metadata is accepted, but keys that look sensitive, such as `secret`, `privateKey`, `token`, `signature`, or `credential`, are redacted from the audit preview.

## Result Codes

- `verified`: task, networks, source transaction, settled bridge event, and freshness checks all passed.
- `invalid_json`: payload could not be parsed.
- `invalid_schema`: required proof fields are missing.
- `task_not_found`: proof references a task that is not loaded.
- `task_mismatch`: proof conflicts with the selected task.
- `network_mismatch`: proof networks are not configured on the task.
- `source_not_confirmed`: source chain status or transaction hash does not match.
- `bridge_event_missing`: no matching bridge event exists.
- `bridge_event_unsettled`: bridge event exists but has not settled.
- `stale_proof`: proof observation is outside the accepted freshness window.

## Security Review

All proof input is treated as attacker-controlled. The verifier does not evaluate code, fetch remote URLs, persist proof payloads, or log raw sensitive fields. Result handling is based on stable codes instead of parsing human-readable messages.

The browser-side verifier is a preflight and review surface, not a replacement for contract-level verification. Any blocked non-retriable proof should go to manual review. Retriable fallback results should request a fresh proof package from the relayer before cross-chain execution is approved.
