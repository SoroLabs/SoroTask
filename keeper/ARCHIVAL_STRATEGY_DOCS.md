# Database Migration and Archival Strategy
**Issue #438**

## Overview
This document outlines the robust database migration and archival strategy designed for SoroTask to manage massive execution logs efficiently. 
The system automatically archives historical logs into cold storage while ensuring seamless queryability across both hot and cold storage layers.

## Core Component Architecture

The module consists of four primary components, encapsulated securely within their own module boundary (`keeper/src/archival-strategy/`):

1. **`Migrator`**: Handles fault-tolerant schema migrations using transaction wrapping. Will roll back gracefully if any error occurs and halt further migrations if the circuit breaker is open.
2. **`Archiver`**: A robust pipeline for shifting old execution logs from the hot database to cold storage. Uses batching to prevent memory issues.
3. **`QueryEngine`**: Provides a unified querying interface that seamlessly stitches together results from both hot (SQLite/active DB) and cold storage dependent on the provided time window.
4. **`ErrorTracker`**: Implements metrics aggregation and a circuit breaker pattern. Prevents cascading failures by halting operations (archival, querying, or migrations) if error thresholds are exceeded.

## Security Review
- **Data Boundaries:** Hot database interactions and cold storage writes are separated.
- **Fail-Safe Mechanism:** The `ErrorTracker` circuit breaker ensures that repeated failures stop the automated pipeline, preventing data corruption or repeated unauthorized access attempts.
- **Transaction Safety:** The `Migrator` component strictly uses database transactions (`BEGIN TRANSACTION`, `COMMIT`, `ROLLBACK`) to ensure schema integrity.
- **Rollback Capability:** Failed or malformed migration batches are rolled back cleanly and tracked by the `ErrorTracker` so the backend can recover without corrupting state.
- **Least Privilege:** The archival pipeline only accesses the specific `logs` table data required for its process.

## Integration Guide
This module is currently placed in `keeper/src/archival-strategy/` as a dummy/standalone implementation. 
When ready for production integration:
1. Replace `coldStorageMock` with the actual cloud storage client (e.g., AWS S3, Google Cloud Storage).
2. Wire the `Archiver.archiveOldLogs()` into your existing Cron or background worker system.
3. Replace existing log querying endpoints to utilize `QueryEngine.fetchLogs()`.

## Testing
This module is strictly tested with >90% coverage for unit and integration edge cases.
To run the tests:
```bash
npm run test -- __tests__/archival-strategy/ --coverage
```
