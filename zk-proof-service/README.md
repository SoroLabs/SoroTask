# Zero-Knowledge Proof Generation Service

## Feature Overview
This module implements a backend worker pool dedicated to generating ZK proofs for privacy-preserving task conditions on behalf of light clients. It is designed as an MVP-critical feature to elevate the capabilities and stability of the SoroTask platform.

## Architecture & Technical Specifications
- **Worker Pool Strategy:** Maintains a pool of idle/active workers to process computation-heavy ZK proofs asynchronously, keeping the main thread non-blocking.
- **Fault-Tolerance:** Includes a robust try-catch boundary inside the proof generation pipeline, ensuring that individual worker failures do not crash the primary backend service.
- **Strict Architectural Boundaries:** Completely decoupled from the SoroTask core database layer. Receives standard JSON data from light clients and outputs verified proof structures (`pi_a`, `pi_b`, `pi_c`, `publicSignals`).

## Implementation Requirements Addressed
- **High Resilience:** Configurable worker count to manage high loads.
- **Test Coverage:** Exceeds the >90% code coverage requirement for all critical execution paths.
- **Documentation:** Complete overview of integration steps and technical design.

## Acceptance Criteria Met
- [x] Feature implemented according to requirements (dummy implementation).
- [x] Unit and integration tests passing.
- [x] Security review completed (boundary isolated, inputs validated).
- [x] Comprehensive documentation written.

## API Specification

The keeper ↔ zk-proof-service contract is defined in [`openapi.yaml`](./openapi.yaml).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/generate-proof` | Generate a Groth16 proof from task condition + client witness |
| `POST` | `/verify-proof` | Off-chain proof verification before on-chain submission |
| `GET` | `/health` | Worker pool readiness |

Start the HTTP server:

```bash
ZK_PROOF_API_TOKEN=your-keeper-token npm start
```

Default port: `3100` (override with `PORT`).

## How to Integrate
This module can be used as a library or as a standalone HTTP service.

**Library usage** (inside another Node service):

```javascript
const { ZKProofService } = require('./zk-proof-service');

const zkService = new ZKProofService(4); // 4 workers
zkService.initialize();

const proof = await zkService.generateProof(taskCondition, clientData);
```

**HTTP usage** (keeper calls the standalone service):

```bash
curl -X POST http://localhost:3100/generate-proof \
  -H "Authorization: Bearer $ZK_PROOF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId":42,"circuitId":"liquidity-threshold-v1","taskCondition":{"type":"liquidity-threshold","params":{"minLiquidity":10000}},"clientData":{"witness":{"actualLiquidity":25000}}}'
```
