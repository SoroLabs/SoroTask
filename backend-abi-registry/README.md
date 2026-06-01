# Automated Smart Contract ABI Registry and Parser

This is a standalone "dummy" implementation of the ABI Registry and Parser, built to fulfill the MVP-critical feature #441 for the backend. As per the architectural guidelines, this directory encapsulates the entire functionality and can be moved/integrated into the main backend (e.g. `indexer` or `keeper`) when needed.

## Features Overview
- **Continuous Monitoring:** Resilient polling system (`monitor.js`) to track newly deployed smart contracts.
- **ABI Extraction:** Decoupled parsing logic (`parser.js`) to extract and standardize ABIs from raw bytecode.
- **Searchable Registry:** Fast in-memory map (`registry.js`) allowing searches by function name and retrieval by contract address.
- **Fault-Tolerant Pipeline:** Fully wrapped with an `ErrorHandler` to catch, log, and recover from simulated node failures or parse errors without crashing the main service.

## Architecture Boundaries
1. **Separation of Concerns:** Each subsystem (monitor, parser, registry) is completely decoupled.
2. **Stateless Operations:** The parser operates statelessly.
3. **Resiliency:** Unhandled errors during polling or processing are caught and stored for fallback procedures.

## How to Test
This package has strict >90% test coverage requirements. To run the tests, use:
```bash
npm install
npm test
```

## Integration
To integrate into the main project:
1. Move the desired components into the target backend folder (e.g. `/indexer`).
2. Instantiate `ABIRegistryService` from `index.js`.
3. Call `start()` to begin monitoring.
4. Access the searchable registry via `getRegistry()`.
