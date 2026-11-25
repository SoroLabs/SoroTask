# Requirements Document

## Introduction

This feature integrates the Halo2 proof system into the existing `zk-proof-service` as a universal Structured Reference String (SRS) verification gateway. Unlike Groth16, which requires a distinct per-circuit trusted setup ceremony for every new task condition circuit, Halo2 uses a universal SRS that supports arbitrary circuits without additional ceremony coordination. The gateway exposes two new authenticated HTTP endpoints (`POST /generate-proof/halo2` and `POST /verify-proof/halo2`) that mirror the existing Groth16 endpoint contract while internally delegating to the `halo2-wasm` prover/verifier engine. All existing Groth16 endpoints and behaviours are preserved without modification.

---

## Glossary

- **Halo2_Engine**: The `halo2-wasm` WebAssembly prover and verifier library integrated into the service.
- **SRS** (Structured Reference String): The universal cryptographic parameter set used by Halo2 that supports any circuit without per-circuit ceremonies.
- **Halo2_Proof**: A proof object produced by the Halo2_Engine, containing a `bytes` field (hex-encoded proof bytes) and a `publicInputs` array (hex-encoded field elements).
- **Halo2_Gateway**: The new subsystem within `zk-proof-service` that handles Halo2 proof generation and verification.
- **ZKProofService**: The existing worker-pool-backed service class in `index.js` managing Groth16 proof operations.
- **Groth16_Proof**: The existing proof format with fields `pi_a`, `pi_b`, `pi_c`, and `publicSignals`.
- **Circuit_Config**: A JSON-serialisable object describing the circuit's constraint system, passed by the caller and forwarded to the Halo2_Engine.
- **Condition_Hash**: A SHA-256 hex digest (prefixed `0x`) of the canonical JSON representation of a `taskCondition` object, computed using `hashTaskCondition` in `lib/helpers.js`.
- **Worker_Pool**: The pool of worker slots managed by `ZKProofService`; also used by Halo2_Gateway operations.
- **Bearer_Token**: The API authentication token passed in the `Authorization: Bearer <token>` header, validated against the `ZK_PROOF_API_TOKEN` environment variable.

---

## Requirements

### Requirement 1: Universal SRS Initialisation

**User Story:** As a service operator, I want the Halo2 SRS to be loaded once at startup so that no per-circuit trusted setup is needed when new circuits are deployed.

#### Acceptance Criteria

1. WHEN the service starts and the `HALO2_SRS_PATH` environment variable is set to a valid file path, THE Halo2_Gateway SHALL load the SRS parameters from that file into memory before accepting requests on `/generate-proof/halo2` or `/verify-proof/halo2`.
2. WHEN the service starts and `HALO2_SRS_PATH` is not set, THE Halo2_Gateway SHALL use a built-in default in-memory SRS with a maximum supported circuit degree of 2^10.
3. IF the file referenced by `HALO2_SRS_PATH` cannot be read or its contents cannot be parsed as a valid SRS, THEN THE Halo2_Gateway SHALL log an error message containing the failure reason and set its `isReady` property to `false`.
4. IF `isReady` is set to `false` due to an SRS load failure, THEN THE Halo2_Gateway SHALL NOT proceed to serve requests on `/generate-proof/halo2` or `/verify-proof/halo2`.
5. THE Halo2_Gateway SHALL expose an `isReady` boolean property that is `false` during SRS initialisation and becomes `true` only after SRS initialisation completes successfully.
6. THE Halo2_Gateway SHALL complete SRS initialisation within 30 seconds of service startup; IF initialisation has not completed within 30 seconds, THEN THE Halo2_Gateway SHALL set `isReady` to `false`.
7. IF SRS initialisation exceeds 30 seconds, THEN THE Halo2_Gateway SHALL log a timeout error message identifying the elapsed time.
8. WHILE `isReady` is `false`, THE Halo2_Gateway SHALL return HTTP 503 with error code `SERVICE_NOT_READY` for any request to `/generate-proof/halo2` or `/verify-proof/halo2`.

---

### Requirement 2: Halo2 Proof Generation Endpoint

**User Story:** As a task automation client, I want to generate a Halo2 proof for a task condition without coordinating a circuit-specific ceremony, so that I can add new condition types quickly.

#### Acceptance Criteria

1. THE Halo2_Gateway SHALL expose a `POST /generate-proof/halo2` endpoint that accepts a JSON request body with a maximum size of 1 MB.
2. IF the request to `POST /generate-proof/halo2` is missing one or more of the fields `taskId`, `circuitId`, `circuitConfig`, `taskCondition`, or `clientData`, THEN THE Halo2_Gateway SHALL return HTTP 400 with error code `INVALID_INPUT` and a `missingFields` array listing all absent field names.
3. IF `taskCondition.type` is absent or not a non-empty string, OR IF `taskCondition.params` is absent or null, THEN THE Halo2_Gateway SHALL return HTTP 400 with error code `INVALID_INPUT`.
4. IF `clientData.witness` is absent or null, THEN THE Halo2_Gateway SHALL return HTTP 400 with error code `INVALID_INPUT`.
5. WHILE the Halo2_Gateway `isReady` is `false`, THE Halo2_Gateway SHALL return HTTP 503 with error code `SERVICE_NOT_READY` for any request to `POST /generate-proof/halo2`.
6. IF the Worker_Pool has no idle workers when a request is received on `POST /generate-proof/halo2`, THEN THE Halo2_Gateway SHALL return HTTP 503 with error code `SERVICE_NOT_READY` and the message `"Worker pool at capacity"`.
7. IF the `clientData` witness does not satisfy the `taskCondition` constraints as evaluated by `checkConstraint`, THEN THE Halo2_Gateway SHALL return HTTP 422 with error code `CONSTRAINT_UNSATISFIED` and a `details` object identifying the failing field and constraint expression.
8. WHEN a valid request is received and a worker is available, THE Halo2_Gateway SHALL invoke the Halo2_Engine to generate a proof and return HTTP 200 with a JSON body containing: `proofId` (UUID string), `status` (the string `"success"`), `taskId`, `conditionHash` (Condition_Hash of `taskCondition`), `proof` (Halo2_Proof object), `serializedProof` (hex-encoded proof prefixed `0x`), `generatedAt` (ISO 8601 UTC timestamp), and `processingTimeMs` (non-negative integer milliseconds elapsed from request receipt to response).
9. IF the Halo2_Engine throws an error during proof generation, THEN THE Halo2_Gateway SHALL return HTTP 500 with error code `PROOF_GENERATION_FAILED` and the engine error message with stack traces and system paths removed.
10. IF the request to `POST /generate-proof/halo2` does not include a valid Bearer_Token, THEN THE Halo2_Gateway SHALL return HTTP 401 with error code `UNAUTHORIZED` before performing any other validation.
11. IF proof generation has not completed within 60 seconds of the Halo2_Engine being invoked, THEN THE Halo2_Gateway SHALL release the worker, return HTTP 503 with error code `SERVICE_NOT_READY`, and include a message indicating a proof generation timeout.

---

### Requirement 3: Halo2 Proof Verification Endpoint

**User Story:** As a task automation client, I want to verify a previously generated Halo2 proof so that I can confirm a task condition was satisfied without re-running the prover.

#### Acceptance Criteria

1. THE Halo2_Gateway SHALL expose a `POST /verify-proof/halo2` endpoint that accepts a JSON request body.
2. IF the request to `POST /verify-proof/halo2` is missing one or more of the fields `taskId`, `circuitId`, `circuitConfig`, `taskCondition`, or `proof`, THEN THE Halo2_Gateway SHALL return HTTP 400 with error code `INVALID_INPUT` and a `missingFields` array listing all absent field names.
3. IF `proof.bytes` is absent, not a string, does not begin with `0x`, contains non-hexadecimal characters after the prefix, or has a hex-encoded length exceeding 131,072 characters (65,536 bytes), THEN THE Halo2_Gateway SHALL return HTTP 400 with error code `INVALID_INPUT`.
4. IF `proof.publicInputs` is absent, not an array, is an empty array, contains more than 64 elements, or contains any element that is not a string beginning with `0x` followed only by hexadecimal characters, THEN THE Halo2_Gateway SHALL return HTTP 400 with error code `INVALID_INPUT`.
5. WHILE the Halo2_Gateway `isReady` is `false`, THE Halo2_Gateway SHALL return HTTP 503 with error code `SERVICE_NOT_READY` for any request to `POST /verify-proof/halo2`.
6. IF the optional `conditionHash` field is present in the request and its value does not equal the Condition_Hash derived from the supplied `taskCondition`, THEN THE Halo2_Gateway SHALL set `valid` to `false` and `conditionHashMatch` to `false` in `verificationDetails` without invoking the Halo2_Engine.
7. WHEN a valid request is received, THE Halo2_Gateway SHALL invoke the Halo2_Engine to verify the proof and return HTTP 200 with a JSON body containing: `valid` (boolean), `proofId` (the value of `proof.proofId` if present and a string, otherwise `null`), `taskId`, `conditionHash` (Condition_Hash of `taskCondition`), `verifiedAt` (ISO 8601 UTC timestamp), and `verificationDetails` (object with `circuitId` string, `publicInputsMatch` boolean derived from comparing the proof's public inputs against those derived from `taskCondition` and `circuitConfig`, `conditionHashMatch` boolean set to `true` when no `conditionHash` was supplied or when it matches, and `reason` string present only when `valid` is `false`).
8. IF the Halo2_Engine throws an error during proof verification, THEN THE Halo2_Gateway SHALL return HTTP 500 with error code `PROOF_VERIFICATION_FAILED` and the engine error message with stack traces and system paths removed.
9. IF the request to `POST /verify-proof/halo2` does not include a valid Bearer_Token, THEN THE Halo2_Gateway SHALL return HTTP 401 with error code `UNAUTHORIZED` before performing any other validation.

---

### Requirement 4: Halo2 Proof Object Serialisation

**User Story:** As a developer integrating the gateway, I want a consistent serialisation format for Halo2 proofs so that proofs can be stored, transmitted, and re-parsed reliably.

#### Acceptance Criteria

1. WHEN `serializeHalo2Proof(proof)` is called with a Halo2_Proof object whose `bytes` is a byte array and `publicInputs` is an array of field element strings, THE Halo2_Gateway SHALL return a hex string prefixed `0x` produced by encoding the UTF-8 JSON representation of `{ bytes, publicInputs }` as hex.
2. WHEN `deserializeHalo2Proof(hex)` is called with a hex string produced by `serializeHalo2Proof`, THE Halo2_Gateway SHALL return a Halo2_Proof object by reversing the hex-to-bytes-to-JSON process.
3. THE Halo2_Gateway SHALL guarantee that for any valid Halo2_Proof object `p`, `deserializeHalo2Proof(serializeHalo2Proof(p))` produces an object with identical `bytes` content and `publicInputs` elements in the same order as `p`.
4. IF `deserializeHalo2Proof` is called with a value that does not begin with `0x` or that contains non-hexadecimal characters after the prefix, THEN THE Halo2_Gateway SHALL return a parse error value indicating malformed hex input without throwing an uncaught exception.
5. IF the hex-decoded content of the deserialiser input does not parse as JSON, or the resulting JSON object does not contain `bytes` as a byte array and `publicInputs` as an array, THEN THE Halo2_Gateway SHALL return a parse error value indicating invalid Halo2_Proof structure without throwing an uncaught exception.

---

### Requirement 5: Health Endpoint Halo2 Status Reporting

**User Story:** As a service operator, I want the health endpoint to reflect Halo2 Gateway readiness so that I can monitor the full service status in one call.

#### Acceptance Criteria

1. WHEN a request is received on `GET /health`, THE Halo2_Gateway SHALL include a `halo2` object in the response JSON containing `isReady` (boolean reflecting the current `isReady` state) and `srsSource` (the string `"file"` when loaded from `HALO2_SRS_PATH`, the string `"default"` otherwise).
2. IF the Halo2_Gateway `isReady` is `false` and the Worker_Pool is healthy (at least one idle worker exists), THEN THE Halo2_Gateway SHALL cause the `GET /health` response to return HTTP 503 with the overall `status` field set to `"degraded"`.
3. IF the Halo2_Gateway `isReady` is `true` and the Worker_Pool is healthy, THEN THE `GET /health` response SHALL return HTTP 200 with the overall `status` field set to `"ok"` and SHALL NOT be degraded by the Halo2_Gateway state.

---

### Requirement 6: Backward Compatibility with Groth16 Endpoints

**User Story:** As an existing API consumer, I want the Groth16 endpoints to continue working unchanged so that I don't need to update existing integrations.

#### Acceptance Criteria

1. THE Halo2_Gateway integration SHALL NOT add, remove, or rename any field in the request or response bodies of `POST /generate-proof` or `POST /verify-proof`, as those schemas are defined in `openapi.yaml` and `server.js` at the time this feature is introduced.
2. THE Halo2_Gateway integration SHALL NOT modify the observable behaviour of `ZKProofService` methods `generateProof`, `verifyProof`, `getWorkerPoolStatus`, `getUptimeSeconds`, `initialize`, or `shutdown` — including their signatures, thrown error messages, and return value shapes.
3. THE Halo2_Gateway integration SHALL NOT cause `POST /generate-proof` or `POST /verify-proof` to return any error code other than `INVALID_INPUT`, `SERVICE_NOT_READY`, `PROOF_GENERATION_FAILED`, `PROOF_VERIFICATION_FAILED`, `CONSTRAINT_UNSATISFIED`, or `UNAUTHORIZED`.
4. WHEN the service is started with only the `ZK_PROOF_API_TOKEN` environment variable set (and no Halo2-specific variables), existing Groth16 clients SHALL be able to authenticate and use `POST /generate-proof` and `POST /verify-proof` without any configuration changes.

---

### Requirement 7: Circuit Config Passthrough

**User Story:** As a circuit developer, I want to pass an arbitrary circuit configuration to the Halo2 prover without the gateway altering or validating its internal structure, so that I can iterate on circuits without service-side changes.

#### Acceptance Criteria

1. WHEN a `POST /generate-proof/halo2` or `POST /verify-proof/halo2` request contains a `circuitConfig` object, THE Halo2_Gateway SHALL pass the value to the Halo2_Engine with identical keys, values, and structure as received, without adding, removing, or reordering any fields.
2. IF `circuitConfig` is absent, is `null`, or is not a JSON object (including arrays and primitives), THEN THE Halo2_Gateway SHALL return HTTP 400 with error code `INVALID_INPUT` and SHALL NOT forward the request to the Halo2_Engine. An empty object `{}` is a valid value.
3. THE Halo2_Gateway SHALL NOT inspect, transform, or impose schema constraints on the contents of `circuitConfig` beyond the type check in criterion 2.
4. IF the `circuitConfig` object exceeds 1 MB when serialised to JSON, THEN THE Halo2_Gateway SHALL return HTTP 400 with error code `INVALID_INPUT` indicating the payload size limit was exceeded.
