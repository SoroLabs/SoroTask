# Recursive proof aggregation (Issue #790)

Verifying N individual ZK proofs on-chain costs roughly N times the gas of
verifying one. Real aggregation lets many proofs collapse into a single
proof/verification at genuine gas savings.

## What's implemented

`lib/proof-aggregator.js` (`ProofAggregator`):
- `estimateGasSavings(proofCount)` — real, correct arithmetic on
  configurable per-proof vs. aggregate on-chain verification gas costs, so
  you can tell *before* aggregating whether it's actually worth it for a
  given batch size.
- `aggregate(proofs)` — batches proofs and delegates the actual
  combination to a pluggable `backend.aggregate(proofs)`.

## What's deliberately NOT implemented

The aggregation math itself. Recursive proof aggregation (SnarkPack,
Nova-style folding, or a Halo2 accumulation scheme matching this service's
existing prover in `lib/halo2-adapter.js`) is a specialized cryptographic
construction — not something to hand-roll without a proving-system-matched
implementation and a security review. A fake "aggregate proof" that isn't
a real cryptographic accumulator would verify as valid while actually
proving nothing, which is worse than not having this feature at all.

Calling `aggregate()` without a configured `backend` throws a clear error
explaining this, rather than silently returning something that looks like
an aggregate proof but isn't one.

## To finish this for real

1. Pick a construction that matches `lib/halo2-adapter.js`'s existing
   proving system (a Halo2-native accumulation scheme is the most direct
   fit, since it avoids introducing a second, incompatible proof system
   just for aggregation).
2. Implement `{ aggregate(proofs): Promise<AggregateProof> }` against that
   construction — likely as a Rust/WASM module given the cryptographic
   work involved, invoked from Node the same way the existing prover
   backend is.
3. Write the corresponding on-chain verifier for the aggregate proof
   format (the actual source of the gas savings — an aggregate proof only
   helps if verifying it on-chain is cheaper than verifying each input
   proof individually).
4. Get an external cryptography review before using it to gate anything
   of real value — this is the class of bug that doesn't show up in normal
   testing.
