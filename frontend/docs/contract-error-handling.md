# Contract Error Handling — Spike

This document captures the result of the "Improve Smart Contract Error
Handling and Recovery Messaging" spike. The frontend has no on-chain code
yet — this work establishes the error model, the user-facing presentation,
and the integration pattern that on-chain features will plug into when they
land.

## TL;DR

- One mapper: `mapContractError(unknown) → MappedContractError`
  in [`src/lib/errors/contractErrors.ts`](../src/lib/errors/contractErrors.ts).
- One banner: `<ContractErrorBanner>` in
  [`src/components/ContractErrorBanner.tsx`](../src/components/ContractErrorBanner.tsx).
- Demo route: `/errors-demo` exercises every category and lets you paste a
  custom error shape to see how it gets classified.

## Why a single mapper

The contributor issue lists four call sites we'll eventually have:

1. **Wallet** (Freighter / xBull / Albedo) — connect, sign, switch network.
2. **Soroban RPC** — `simulateTransaction`, `sendTransaction`,
   `getTransaction`.
3. **Stellar Horizon / classic transactions** — sequence number issues,
   fee bumps, auth.
4. **Contract code itself** — host traps, asserts, custom error codes.

Each of these throws a different shape. A wallet error is an `Error` whose
`message` carries a phrase like "User declined access". A Soroban simulate
error is an object with `error: "..."` and `status: "FAILED_SIMULATION"`. A
Horizon submit error has `resultXdr` with `txBadSeq` inside. RPC transport
errors have HTTP `status` codes.

If every component runs its own `if (e.message.includes(…))` ladder, we get
inconsistent UI, duplicated copy, and bugs where the same error shows
different messages on different screens. The fix is one mapper that owns
all of the duck-typing, and one banner that owns all of the visual
treatment. Components only see the mapped result.

## Error model

```ts
interface MappedContractError {
  category: ContractErrorCategory;          // 21 enum values
  title: string;                            // user-facing headline
  userMessage: string;                      // user-facing explanation
  action: "retry" | "wait" | "fix_input" | "none";
  retryable: boolean;
  debug: {
    name?: string;
    message: string;
    code?: string | number;
    raw?: unknown;
  };
}
```

**`category`** — fine-grained enum. Codes that overlap with the keeper
([keeper/src/retry.js](../../keeper/src/retry.js)) keep the same names
(`BAD_SEQUENCE`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_GAS`, `INVALID_ARGS`,
`TIMEOUT`, …) so cross-system log searches work. Wallet-only categories
(`WALLET_NOT_INSTALLED`, `WALLET_LOCKED`, `WALLET_REJECTED`,
`WRONG_NETWORK`) and Soroban-state categories (`STATE_EXPIRED`,
`SIMULATION_FAILED`, `CONTRACT_REVERT`) are added on top.

**`action`** — coarse signal for the UI to pick the right affordance:

| action      | UI behavior                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| `retry`     | Show a "Try again" button — same call could succeed.                         |
| `wait`      | Caller is auto-retrying with backoff. Show a wait indicator, hide buttons.   |
| `fix_input` | User must change something (input, balance, network) before retrying.        |
| `none`      | Terminal state with no recovery (e.g. `DUPLICATE_TRANSACTION`).              |

**`retryable`** — boolean that tells the *caller* (not just the UI)
whether to bother retrying. The keeper's classifier returns the same
distinction; we keep it explicit so a caller using a retry hook can do
`if (mapped.retryable) scheduleRetry()` without inspecting the category.

**`debug`** — full technical detail. Always populated, never shown unless
the user clicks "Show technical details" on the banner. Includes the raw
error object so a developer can paste a JSON dump into a bug report.

## Classification rules

`mapContractError` runs these checks in order. First match wins:

1. **Keeper code map** — if `error.code` (uppercased) matches one of
   `TX_BAD_SEQ`, `TX_INSUFFICIENT_BALANCE`, `INVALID_ARGS`, etc., use the
   mapped category directly. Code wins over message because XDR result
   codes are unambiguous.
2. **Wallet messages** — substring match on phrases like
   `"user declined"`, `"freighter is locked"`, `"network passphrase mismatch"`.
3. **Soroban host / state** — `"entry expired"`, `"restorepreamble"`,
   `"simulation failed"`. Inside a simulation failure, host traps
   (`"vm error"`, `"contract panicked"`) become `CONTRACT_REVERT` rather
   than the generic `SIMULATION_FAILED`.
4. **Embedded XDR codes** — `tx_bad_seq`, `tx_insufficient_fee`, etc.,
   inside the message body for cases where the error wasn't structured
   with a `code` field.
5. **Network / transport** — substring matches on `timeout`,
   `econnrefused`, `fetch failed`, plus HTTP `status` 429 / 5xx.
6. **Fallback** — `UNKNOWN`. Action is `retry` so the user can at least
   try again; the debug panel lets them capture the raw error.

The function never throws. Null, undefined, primitives, and circular
objects all pass through as `UNKNOWN`.

## Integration pattern

```tsx
import { mapContractError } from "@/src/lib/errors/contractErrors";
import { ContractErrorBanner } from "@/src/components/ContractErrorBanner";

function CreateTaskForm() {
  const [error, setError] = useState<MappedContractError | null>(null);

  async function submit(input: TaskInput) {
    setError(null);
    try {
      await registerTask(input);
    } catch (e) {
      setError(mapContractError(e));
    }
  }

  return (
    <>
      {/* form */}
      {error && (
        <ContractErrorBanner
          error={error}
          onRetry={error.action === "retry" ? () => submit(lastInput) : undefined}
          onDismiss={() => setError(null)}
        />
      )}
    </>
  );
}
```

For flows that auto-retry (e.g. `BAD_SEQUENCE` recovery) the caller should
keep the banner mounted across retries and pass `actionOverride="wait"` so
the retry button stays hidden until the auto-retry loop gives up.

## Tradeoffs and limitations

- **Substring matching is fragile.** Wallet libraries change error messages
  without bumping major versions. Every wallet-related substring is a
  maintenance liability — when Freighter, xBull, or Albedo land in the
  app, replace the substring rules with their structured error types
  (`FreighterError`, etc.) where available, and keep substrings only as a
  fallback.
- **No real wallet integration here.** The mapper is built against synthetic
  fixtures shaped like the real errors. Once a real wallet is wired up,
  expect a few additional cases — particularly around hardware wallets,
  multi-signature flows, and timeouts mid-signing. Add fixtures to
  [`src/lib/errors/fixtures.ts`](../src/lib/errors/fixtures.ts) and a test
  case for each.
- **No real RPC payload coverage.** Soroban's `simulateTransaction` returns
  rich error structures (host error events, diagnostic events, restore
  preamble). The current mapper looks at the top-level message string. A
  follow-up should extend `MappedContractError.debug` to carry the
  diagnostic events when present, so the dev panel shows them.
- **One banner shape, no toast variant yet.** The banner is inline. A
  future toast / global error surface should reuse the same
  `MappedContractError` shape — only the presentation layer changes.
- **No i18n.** All copy is in English in `COPY` inside the mapper. When
  i18n lands, replace the inline strings with translation keys and keep
  the keys parallel to the category names.

## Acceptance criteria, mapped

| Criterion                                                          | How this spike addresses it                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Raw blockchain errors are translated into clear UI feedback.       | `mapContractError` covers 21 categories with title + message; `<ContractErrorBanner>` renders them.                    |
| Users can tell whether to retry, wait, or change input.            | The four `action` values drive distinct affordances (button / wait dot / input-fix tone / none).                       |
| Developer-debuggable context remains available where appropriate.  | The "Show technical details" panel shows category, code, name, message, and raw payload as JSON.                       |
| Error handling is consistent across on-chain flows.                | Single shared mapper + single shared banner; integration pattern documented above so all call sites converge on it.    |

## Follow-ups for the next contributor

1. When the wallet integration lands, replace the wallet substring rules
   with the wallet library's structured error types. Add fixtures.
2. When Soroban RPC calls land, extend `debug` to surface diagnostic
   events, restore preamble, and host error metadata.
3. Wire `<ContractErrorBanner>` into a global toast container so callers
   can `showContractError(e)` from anywhere.
4. Consider a `useContractCall(fn)` hook that wraps a promise, owns the
   retry/backoff loop, and returns `{ status, error, retry }` where
   `error` is already a `MappedContractError`. Most call sites would no
   longer touch `mapContractError` directly.
