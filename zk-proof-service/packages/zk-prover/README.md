# @sorotask/zk-prover

Client-side Zero-Knowledge proof generation for SoroTask (#852). Runs
[snarkjs](https://github.com/iden3/snarkjs)'s Groth16 WASM prover directly
in the browser so private witness data never has to be sent to a server —
sending it to the `zk-proof-service` backend requires trusting that
service's host with it.

On devices that look too memory-constrained to run the WASM prover
reliably, it automatically falls back to calling the `zk-proof-service`
backend's `POST /generate-proof` instead.

## Install

```sh
npm install @sorotask/zk-prover
# Only needed if you want browser-side proving (the fallback path doesn't need it):
npm install snarkjs
```

## Usage

```js
const { generateProof } = require('@sorotask/zk-prover');

const result = await generateProof({
  // Browser-proving path:
  input: { a: 3, b: 5 },
  wasmUrl: '/circuits/liquidity_threshold.wasm',
  zkeyUrl: '/circuits/liquidity_threshold_final.zkey',

  // Backend-fallback path (used automatically on constrained devices):
  backendBaseUrl: 'https://zk.sorotask.example.com',
  backendPayload: {
    taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 100 } },
    clientData: { witness: { actualLiquidity: 150 } },
  },
});

console.log(result.source); // 'browser' or 'backend'
console.log(result.proof, result.publicSignals);
```

## How the fallback decision is made

`shouldUseFallback()` checks, in order:
1. Is `WebAssembly` unavailable at all? → fall back.
2. Does the browser report (via the non-standard `navigator.deviceMemory`,
   Chromium-only) less than `minDeviceMemoryGb` (default `4`)? → fall back.
3. Otherwise, prove locally.

`navigator.deviceMemory` isn't implemented in every browser (notably
Safari/Firefox). When it's unreported, this assumes the device **can**
run the prover rather than silently routing everyone through the backend
on browsers that just don't expose the API — that would defeat this
package's privacy goal for most users.

You can override the memory threshold or inject a mock `navigator` (useful
for testing or non-browser environments):

```js
const { shouldUseFallback } = require('@sorotask/zk-prover');
shouldUseFallback({ minDeviceMemoryGb: 2, nav: { deviceMemory: 3 } }); // false
```

## API

- `generateProof(params, options)` — the main entry point described above.
- `generateProofInBrowser(input, wasmUrl, zkeyUrl)` — always proves locally via snarkjs; throws if `snarkjs` isn't installed.
- `generateProofViaBackend(baseUrl, payload, options)` — always calls the backend; `options.fetch` and `options.authToken` are supported for non-browser use and auth.
- `shouldUseFallback(options)` — the fallback heuristic on its own.
