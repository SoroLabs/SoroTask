# Requirements Document

## Introduction

This feature adds a client-side WASM proof generation library (`@sorotask/zk-client`) that packages the SnarkJS prover for in-browser use. Users generate ZK proofs locally without transmitting private witness data over the network. On low-resource devices (e.g., mobile) where WASM execution is constrained, the library transparently falls back to the existing `zk-proof-service` backend. The library must be compatible with modern web bundlers (Vite, Webpack) and produce proofs structurally identical to those produced by the backend service so that the existing verification path in `zk-proof-service` remains unchanged.

## Glossary

- **ZK_Client**: The `@sorotask/zk-client` npm package — the client-side library described in this document.
- **WASM_Prover**: The WebAssembly-compiled SnarkJS Groth16 prover bundled inside ZK_Client.
- **Backend_Prover**: The existing `zk-proof-service` HTTP API (`POST /generate-proof`) used as a fallback.
- **Proof**: A Groth16 proof object with fields `pi_a`, `pi_b`, `pi_c`, and `publicSignals`, matching the structure returned by `zk-proof-service`.
- **Serialized_Proof**: A hex-encoded string representation of a Proof, produced by the `serializeProof` helper already present in `zk-proof-service/lib/helpers.js`.
- **Witness**: The private input data used during proof generation; it must never leave the user's device when the WASM_Prover is used.
- **Circuit**: A compiled Circom circuit represented by a `.wasm` file (for witness generation) and a `.zkey` file (for proving).
- **Circuit_Registry**: A mapping from `circuitId` strings to the corresponding Circuit asset URLs or bundled assets.
- **Capability_Detector**: The ZK_Client sub-module that determines whether the current runtime environment supports WASM execution and has sufficient memory.
- **Fallback_Client**: The ZK_Client sub-module that calls the Backend_Prover HTTP API when WASM execution is unavailable or fails.
- **ConditionHash**: A `sha256`-derived hex string that uniquely identifies a `taskCondition` object, as computed by `hashTaskCondition` in `zk-proof-service/lib/helpers.js`.

---

## Requirements

### Requirement 1: WASM Proof Generation

**User Story:** As a browser-based SoroTask user, I want proofs to be generated locally in my browser, so that my private witness data never leaves my device.

#### Acceptance Criteria

1. WHEN `ZK_Client.generateProof(circuitId, taskCondition, witness)` is called in a WASM-capable browser environment, THE WASM_Prover SHALL compute the Groth16 proof entirely within the browser process without making any network request that contains any Witness field value.
2. WHEN the WASM_Prover completes proof generation, THE ZK_Client SHALL return a result object containing `proof` (a `Proof` object), `publicSignals`, `conditionHash`, `serializedProof`, and `proofSource` set to `"wasm"`.
3. WHEN `generateProof` is called with a `circuitId` present in the Circuit_Registry, THE ZK_Client SHALL lazily resolve the corresponding `.wasm` and `.zkey` assets at call time before invoking the WASM_Prover.
4. IF a `circuitId` is not found in the Circuit_Registry, THEN THE ZK_Client SHALL reject the returned Promise with an error message identifying the unknown `circuitId`.
5. THE WASM_Prover SHALL produce a `Proof` whose `pi_a` and `pi_c` are arrays of hex strings, `pi_b` is a 2×2 array of hex strings, and `publicSignals` is an array of hex strings, all conforming to the format validated by `isValidZkProof` in `zk-proof-service/lib/helpers.js`.
6. WHEN proof computation via the WASM_Prover has not completed within 120 seconds, THE ZK_Client SHALL reject the returned Promise with a `"wasm-prove"` stage error.

---

### Requirement 2: Device Capability Detection

**User Story:** As a mobile user with limited device resources, I want the library to automatically detect that my device cannot run WASM proofs efficiently, so that I am not stuck waiting for a proof that will never complete.

#### Acceptance Criteria

1. WHEN `ZK_Client.generateProof` is called, THE Capability_Detector SHALL evaluate WASM support and available memory before attempting WASM proof generation.
2. IF `WebAssembly` is not available in the runtime environment, THEN THE Capability_Detector SHALL classify the environment as WASM-incapable.
3. IF the estimated available memory reported by the runtime is below 512 MB, OR IF the runtime memory API returns null or undefined, THEN THE Capability_Detector SHALL classify the environment as WASM-incapable.
4. THE ZK_Client SHALL expose a `checkCapability()` method that returns a `CapabilityResult` object with fields `wasmSupported` (boolean), `estimatedMemoryMB` (number or null), and `canRunLocally` (boolean), where `canRunLocally` is `true` if and only if `wasmSupported` is `true` and `estimatedMemoryMB` is a number greater than or equal to 512.
5. WHILE the Capability_Detector has classified the environment as WASM-incapable, THE ZK_Client SHALL route all `generateProof` calls directly to the Fallback_Client without attempting WASM execution.
6. THE Capability_Detector SHALL re-evaluate WASM support and memory availability at the start of each `generateProof` call and SHALL NOT permanently cache the result of a prior invocation.

---

### Requirement 3: Transparent Fallback to Backend Prover

**User Story:** As a mobile user, I want the library to silently fall back to the server-side proof service when my device cannot generate the proof locally, so that proof generation still succeeds without requiring me to take any action.

#### Acceptance Criteria

1. WHEN the Capability_Detector classifies the environment as WASM-incapable, THE Fallback_Client SHALL submit a `POST /generate-proof` request to the configured Backend_Prover URL with `taskId`, `circuitId`, `taskCondition`, and `clientData` fields.
2. WHEN the Backend_Prover responds with HTTP 200, THE Fallback_Client SHALL resolve the `generateProof` Promise with a result object where `proofSource` is `"backend"` and the `proof`, `publicSignals`, `conditionHash`, and `serializedProof` fields are each present and non-null, populated from the Backend_Prover response body.
3. IF the WASM_Prover throws an error during proof computation, THEN THE ZK_Client SHALL delegate the proof request to the Fallback_Client exactly once, without surfacing the internal WASM error to the caller, provided the Fallback_Client URL is configured.
4. IF the Fallback_Client URL is not configured and WASM execution is unavailable, THEN THE ZK_Client SHALL reject the returned Promise with an error message stating that no proof strategy is available.
5. THE ZK_Client SHALL ensure the returned Promise is always either resolved or rejected, with no unhandled rejection state left pending.
6. IF the Backend_Prover responds with a non-200 HTTP status, THEN THE Fallback_Client SHALL reject the returned Promise with an error message containing the HTTP status code and the Backend_Prover error body.
7. IF the Fallback_Client request does not receive a response within 30 seconds, THEN THE Fallback_Client SHALL reject the returned Promise with a `"backend-request"` stage error indicating a timeout.

---

### Requirement 4: Proof Serialization and Hashing Compatibility

**User Story:** As a SoroTask developer, I want proofs generated client-side to be structurally identical to server-generated proofs, so that the existing `zk-proof-service` verification endpoint can verify client-generated proofs without modification.

#### Acceptance Criteria

1. THE ZK_Client SHALL include a `serializeProof(proof)` function that encodes the fixed field set `pi_a`, `pi_b`, `pi_c`, and `publicSignals` in declaration order using UTF-8 encoding, with keys in that fixed order, producing a hex string prefixed with `0x` using the same algorithm as `serializeProof` in `zk-proof-service/lib/helpers.js`.
2. THE ZK_Client SHALL include a `hashTaskCondition(taskCondition)` function that serializes the top-level keys of `taskCondition` in sorted order (nested keys are not sorted), encodes the result as a UTF-8 string, applies SHA-256, and returns a lowercase hex string prefixed with `0x`, using the same algorithm as `hashTaskCondition` in `zk-proof-service/lib/helpers.js`.
3. WHEN `serializeProof` is called with a `Proof` object generated by the WASM_Prover and with the same `Proof` object on the backend, THE ZK_Client SHALL produce byte-for-byte identical hex output in both contexts.
4. WHEN `ZK_Client.hashTaskCondition(c)` is called with any `taskCondition` object `c`, THE ZK_Client SHALL produce the same ConditionHash as the Backend_Prover computes for the same `c`, noting that nested object key order is not sorted.
5. IF `serializeProof` is called with an argument that does not contain all of `pi_a`, `pi_b`, `pi_c`, and `publicSignals`, THEN `serializeProof` SHALL reject with an error indicating invalid Proof structure.

---

### Requirement 5: Circuit Asset Loading

**User Story:** As a web application developer integrating `@sorotask/zk-client`, I want circuit assets to load efficiently without blocking the main thread, so that the user interface remains responsive during proof setup.

#### Acceptance Criteria

1. WHEN `ZK_Client.generateProof` is called for a given `circuitId` for the first time, THE ZK_Client SHALL fetch the `.wasm` and `.zkey` assets for that circuit from the Circuit_Registry–configured URL within a 30-second timeout per asset.
2. WHEN the same `circuitId` has been loaded previously within the lifetime of the current ZK_Client instance, THE ZK_Client SHALL reuse the in-memory cached circuit assets without re-fetching them from the network.
3. THE ZK_Client SHALL perform circuit asset loading and proof computation within a Web Worker. IF the Web Worker constructor throws, or if `Worker` is not defined in the runtime environment, THEN THE ZK_Client SHALL reject the returned Promise with a `"circuit-load"` stage error and SHALL NOT fall back to main-thread execution.
4. IF a circuit asset fetch returns a non-200 HTTP response, THEN THE ZK_Client SHALL reject the returned Promise with an error message identifying the failed asset URL and the HTTP status code.
5. IF a circuit asset fetch fails due to a network error (e.g., DNS failure, connection refused) rather than an HTTP error status, THEN THE ZK_Client SHALL reject the returned Promise with a `"circuit-load"` stage error identifying the failed asset URL.
6. THE ZK_Client SHALL expose a `preloadCircuit(circuitId)` method that fetches and caches circuit assets for the given `circuitId`, returning a Promise that resolves when both the `.wasm` and `.zkey` assets are fully loaded into the in-memory cache. IF `preloadCircuit` fails, it SHALL reject with a `"circuit-load"` stage error.

---

### Requirement 6: Library Configuration

**User Story:** As a web application developer, I want to configure the ZK_Client library once at startup, so that all subsequent proof generation calls use the correct backend URL and circuit asset locations without repetitive configuration.

#### Acceptance Criteria

1. THE ZK_Client SHALL expose an `init(config)` function that accepts a configuration object with fields `backendUrl` (string, optional), `circuitBaseUrl` (string, optional), and `circuits` (Circuit_Registry map, optional).
2. WHEN `init(config)` is called, THE ZK_Client SHALL store the provided configuration and apply it to all subsequent `generateProof` and `preloadCircuit` calls.
3. IF `generateProof` is called before `init(config)` has been called, THE ZK_Client SHALL apply built-in default values (`backendUrl` = empty string, `circuitBaseUrl` = current page origin, `circuits` = empty map) and proceed without throwing an error.
4. WHEN `init(config)` is called more than once, THE ZK_Client SHALL merge the new configuration values over the existing configuration at the key level: fields present in the new call replace the corresponding fields in the stored configuration; fields absent from the new call retain their existing values. Within the `circuits` map, individual circuit entries are merged by `circuitId` key rather than replacing the entire map.
5. IF `init(config)` is called with a `backendUrl` value that is not an absolute URL (i.e., does not begin with `http://` or `https://`), THEN THE ZK_Client SHALL return an error indicating an invalid `backendUrl` and SHALL NOT update the stored configuration.

---

### Requirement 7: Error Reporting

**User Story:** As a web application developer integrating `@sorotask/zk-client`, I want descriptive error objects when proof generation fails, so that I can display actionable feedback to users and debug integration issues.

#### Acceptance Criteria

1. WHEN `generateProof` rejects, THE ZK_Client SHALL reject with an `Error` object whose `message` field is set to exactly one of the following string values with no additional text appended: `"circuit-load"`, `"wasm-prove"`, `"backend-request"`, `"no-strategy"`, or `"unknown"` for unclassified failures.
2. WHEN `generateProof` rejects due to a backend HTTP error, THE ZK_Client SHALL include a `statusCode` property of type `number` on the `Error` object containing the raw HTTP response status code as returned by the backend, without validation or sanitisation.
3. WHEN `generateProof` rejects due to a circuit loading failure, THE ZK_Client SHALL include an `assetUrl` property on the `Error` object identifying the URL that failed to load.
4. WHERE `generateProof` ultimately resolves successfully despite one or more intermediate circuit loading failures, THE ZK_Client SHALL NOT include the `assetUrl` property on the resolved result object.
5. THE ZK_Client SHALL NOT expose input values passed as witness arguments to the proving call in any error message or error object property.
