# Browser Groth16 prover

The `/zk-prover` page generates and verifies Groth16 proofs in a dedicated
browser Web Worker with SnarkJS. Private and public input objects are merged
inside the browser and posted only to that worker. They are never added to
worker logs, analytics, a proof-generation API request, or the generated proof.
Circuit artifacts are loaded from same-origin static URLs only.

## Circuit inputs

Select the circuit in the prover UI. Inputs must be JSON objects with decimal
integer strings for field values:

- **Range:** public inputs `minValue` and `maxValue`; private input
  `secretValue`. The proof establishes that the secret is between the bounds,
  inclusive.
- **Membership:** public input `root`; private inputs `leaf`, `pathElements`,
  and `pathIndices`. The tree is a 20-level Poseidon Merkle tree. Each direction
  is `0` or `1`, and each array must have exactly 20 elements.

The circuit sources are in `zk-proof-service/circuits`. Each circuit needs
matching compiled WASM, a Groth16 proving key, and a verification key:

```text
frontend/public/zk-proofs/range-proof.wasm
frontend/public/zk-proofs/range-proof.zkey
frontend/public/zk-proofs/range-proof-verification_key.json
frontend/public/zk-proofs/membership-proof.wasm
frontend/public/zk-proofs/membership-proof.zkey
frontend/public/zk-proofs/membership-proof-verification_key.json
```

Compile the circuits with Circom 2.1.6 or newer and circomlib (required for the
membership circuit), using circomlib's `circuits` folder as the include path.
Then generate each zkey using the project's reviewed, audited powers-of-tau
ceremony and circuit-specific contribution process. The matching verification
key must be exported from that exact final zkey. Do not generate or deploy
production proving keys with a local, unreviewed ceremony. Membership inputs
must describe a real path whose Poseidon root matches the public `root`.
Generated artifacts are intentionally not checked in: none existed in this
repository, and a proving key cannot safely be substituted with a demo or mock.

The runtime fails with a specific error if an artifact is missing or the proof
does not verify locally. `NEXT_PUBLIC_ZK_ARTIFACT_BASE_URL` can change the
same-origin artifact directory (default `/zk-proofs`); cross-origin artifact
hosts are rejected. Proof generation time is measured in the worker. The
two-second target depends on the deployed circuit's constraint count and the
user's browser/device, so it is not guaranteed by the runtime.

SnarkJS 0.7.6 declares GPL-3.0. Confirm that this dependency's license terms
are compatible with the application's distribution model before shipping the
frontend bundle.
