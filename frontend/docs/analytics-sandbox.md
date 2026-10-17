# Analytics Sandbox

The Analytics Sandbox is available at `/analytics-sandbox`. It lets users model a task execution against a forked testnet snapshot without signing, submitting, or mutating live workflow state.

The task creation wizard at `/tasks/create` also runs a live Soroban pre-flight simulation on its simulation step. It builds an invocation from the connected account, contract, function, and JSON arguments, then calls `simulateTransaction` on the selected network. The wizard refreshes the simulation when the invocation changes and prevents continuing after a failed simulation. It does not sign or submit a transaction.

The wizard reports the RPC minimum resource fee and current median Soroban inclusion fee in XLM, plus the simulated CPU instructions, storage read/write bytes, access footprint, and ledger-entry changes. The inclusion-fee component is a current network estimate; actual fees can change before a transaction is submitted. RPC diagnostic details are accompanied by plain-language suggestions for common authorization, funding, resource-budget, and contract/network errors.

## Architecture

- `src/lib/analytics-sandbox/simulation.ts` contains the typed input model, validation, cost projection, fallback handling, and error tracking.
- `src/components/AnalyticsSandbox.tsx` renders the client-side sandbox and keeps UI state separate from simulation math.
- `app/analytics-sandbox/page.tsx` exposes the route.
- `src/lib/soroban/task-simulation.ts` builds and simulates real contract invocations for the task-creation wizard.
- `app/tasks/create/page.tsx` automatically runs the pre-flight simulation and displays its resource/fee results before allowing the user to continue.

## Security Notes

- The sandbox does not call wallet signing APIs.
- The simulator rejects non-HTTPS RPC URLs except localhost test endpoints.
- Invalid task, contract, interval, gas, ledger, and keeper-count inputs return a blocked result with tracked critical errors.
- Remote simulation failures degrade to deterministic local projection and are recorded as warning-level errors.

## Testing

Run:

```bash
npm test -- analytics-sandbox
```

The tests cover validation, local projections, fallback behavior, and the interactive page flow.
