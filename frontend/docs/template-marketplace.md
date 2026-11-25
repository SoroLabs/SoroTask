# Task Template Marketplace (#1243)

A gallery of reusable task recipes. Fork one, fill in the parameters it asks
for, and deploy the whole flow as a single batched transaction.

Route: **`/marketplace/templates`**

The existing `/marketplace` route is a keeper-bidding board. Task templates live
beside it rather than replacing it — the two audiences are different and both
routes stay useful.

## Architecture

| Piece      | Path                                                                                                                              | Role                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Engine     | [`src/lib/templates.ts`](../src/lib/templates.ts)                                                                                 | Schema, parser, forking, gas estimation, discovery |
| Gallery    | [`app/marketplace/templates/components/TemplateMarketplace.tsx`](../app/marketplace/templates/components/TemplateMarketplace.tsx) | Search + filters + grid                            |
| Card       | [`…/TemplateCard.tsx`](../app/marketplace/templates/components/TemplateCard.tsx)                                                  | Summary and cost preview                           |
| Fork modal | [`…/TemplateForkModal.tsx`](../app/marketplace/templates/components/TemplateForkModal.tsx)                                        | Parameter form, gas preview, deploy                |
| Page       | [`app/marketplace/templates/page.tsx`](../app/marketplace/templates/page.tsx)                                                     | Route                                              |

## Schema and parsing

A template is untrusted data, so it is **validated rather than cast**. The zod
schema enforces the things that would otherwise fail late and confusingly:

- contract addresses must match `C[A-Z0-9]{55}` (reusing the same regex as the
  task-creation form),
- function and parameter names must be lower snake_case, since both become call
  arguments,
- at least one and at most 20 blocks,
- a positive interval no longer than one year.

`parseTemplate` returns the collected messages instead of throwing, so a listing
with a bad field is skippable rather than a blank page. `parseTemplateJson`
reports malformed JSON as a normal error.

The curated templates in `COMMUNITY_TEMPLATES` all derive their example contract
ids from the form schema's own `EXAMPLE_CONTRACT_ADDRESS`. A hand-typed literal
is off-by-one-prone, and an invalid one is rejected by `parseTemplate` — exactly
the kind of thing that only shows up when someone clicks "Use template".

## Forking

`forkTemplate(source, overrides)` produces an independent, deployable copy:

- **every block gets a fresh `instanceId`.** Reusing the source ids would make
  two forks of the same template collide in any store keyed by instance id, and
  would make React reuse DOM nodes across two different recipes.
- **provenance is recorded** (`forkedFrom`, `forkedAt`).
- the copy is marked as the user's own and downgraded to `experimental`.
- **the source is never mutated.**
- values come from `overrides`, falling back to the parameter's `defaultValue`.
  A missing _required_ value throws `MissingParameterError`, naming the step and
  the parameter, rather than producing a task that cannot execute.

`toFlowTemplate` converts a fork into the `FlowTemplate` the existing task
builder already persists, so a fork can be reopened and edited with no new UI.

## Gas estimation

`estimateTemplateGas` previews cost **before** a wallet is opened, which is most
of what makes the sub-60-second deploy achievable — the user is never asked to
sign a transaction whose cost they have not seen.

It separates two amounts that users routinely conflate:

| Field                   | Meaning                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `feeXlm` / `feeStroops` | Paid **now**, to get the transaction included               |
| `reserveXlm`            | Held by the tasks **afterwards**, to pay for future runs    |
| `totalXlm`              | `reserveXlm + feeXlm` — what the user should expect to need |

A template exceeding 20 operations is clamped to the batch limit and reports a
`warning`; the fee covers only the operations that actually fit.

Each step's reserve is floored at `RESERVE_XLM_PER_OPERATION`, so a step declared
with a zero reserve is still funded.

## The starter gallery

| Template                  | Runs          | Steps                          |
| ------------------------- | ------------- | ------------------------------ |
| Daily Yield Harvest       | daily         | Harvest Yield → Sweep Proceeds |
| Balance Sweep             | hourly        | Sweep Balance                  |
| DEX Rebalance             | every 6 hours | Rebalance Swap                 |
| Stake & Compound          | weekly        | Stake Tokens → Claim Rewards   |
| Scheduled Governance Vote | weekly        | Cast Vote                      |

Yield harvesting and balance sweeping are the two recipes named in the
acceptance criteria. Trust tiers are `verified`, `community` and `experimental`,
shown as a badge on every card.

## Deployment

The modal is handed an `onDeploy` callback rather than importing a wallet, so it
owns no chain concerns and the whole flow is testable without one.

The page's implementation validates the batch with the existing
`buildRegistrationBatch` **before** persisting, so a template that could never be
submitted is not saved as if it had been. The fork is then written to
`sorotask.templates`, which is the key `app/tasks/page.tsx` already reads, so it
appears in the "Saved Templates" grid and can be reopened in the builder.

A corrupt or unreadable store is replaced rather than merged into, because losing
the fork the user just created is worse than losing an unparseable old entry.

## Testing

```bash
npm test -- src/lib/__tests__/templates
npm test -- app/marketplace/templates
```

The engine tests cover validation rejections, fork isolation, provenance, gas
arithmetic at and above the batch limit, and schema-validity of every curated
template.
