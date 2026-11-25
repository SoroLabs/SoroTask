# zk-proof-service benchmarks (#856)

Two benchmarks, both writing JSON reports to `results/` (same convention as
`keeper/benchmarks`: `{ name, date, results: [...] }`), comparable with
`compare.js`.

## `proof-service.bench.js` — real numbers, today

Benchmarks the `ZKProofService` that actually exists in this repo:
`generateProof`/`verifyProof` latency at increasing concurrent load (1, 10,
50). This is a load proxy for the "constraint size" axis the issue asks
for, since `ZKProofService`'s (currently mocked) proof generation isn't
parameterized by a real circuit.

```sh
node proof-service.bench.js
node compare.js results/proof-service-<old>.json results/proof-service-<new>.json
```

## `scheme-matrix.bench.js` — the Groth16/Plonk/Halo2 × constraint-size matrix

This is the actual comparison the issue describes: every combination of
`{groth16, plonk, halo2} × {1K, 10K, 100K, 1M}` constraints, reporting
proof size, generation time, verification time, and a gas estimate.

**Every cell is currently reported as `skipped`, honestly**, because none
of the infrastructure to produce real numbers exists in this repo yet:

- Groth16/Plonk need a circuit compiled at each constraint size (a
  `.circom` file plus a trusted-setup `.zkey`) and `snarkjs` installed —
  neither exists here.
- Halo2 needs an entire separate Rust crate — there's no `circom`
  equivalent for it, and this repo has no Halo2 circuit code at all.
- Gas-cost comparison needs an on-chain verifier contract per scheme
  deployed in `contract/`, so a real resource-fee simulation can run
  against it — none exists.

Fabricating plausible-looking numbers for any of this would actively
mislead the developers this tool is meant to help pick a scheme correctly.
`schemes/index.js` documents exactly what each adapter needs; once real
artifacts exist for a scheme, fill in its `generateProof`/`verifyProof` and
`scheme-matrix.bench.js` picks it up automatically — no changes needed to
the runner itself.

```sh
node scheme-matrix.bench.js
```

## Not done here (out of scope for `zk-proof-service/`)

The issue's proposed solution also asks for a frontend docs page
publishing these reports and a "recommended scheme selector" tool for
developers. Both are frontend features (this issue's affected area is
`zk-proof-service/index.test.js`) — once `scheme-matrix.bench.js` has real
data to report, a `frontend/app/.../benchmarks` page reading its JSON
output would be the natural next step.
