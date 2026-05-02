# Requirements Document: Stale Task Cleanup

## Introduction

This document defines requirements for implementing stale task detection and cleanup workflow for backend indexes in the SoroTask contract system. The feature addresses data hygiene concerns by preventing backend task views from accumulating outdated or misleading records that confuse operators and pollute analytics or admin tooling.

The SoroTask contract manages scheduled tasks with persistent storage. Tasks can be cancelled, paused, or become inactive through various lifecycle events. Backend indexers and monitoring systems maintain read models of task state, which can become stale when tasks are removed or when their state changes significantly. This feature provides safe, reviewable mechanisms to detect and clean up stale indexed data while preserving debugging history.

## Glossary

- **SoroTask_Contract**: The smart contract that manages scheduled task registration, execution, and lifecycle
- **Task**: A scheduled job configuration stored in the contract with fields including creator, target, interval, last_run, gas_balance, and is_active status
- **Backend_Index**: An off-chain read model or database view that mirrors task state for monitoring, analytics, or operator tooling
- **Stale_Record**: An indexed task record that no longer accurately reflects on-chain state or has become obsolete based on defined staleness criteria
- **Cleanup_Service**: The component responsible for detecting and removing or archiving stale records from backend indexes
- **Retention_Policy**: Rules defining how long records must be preserved before cleanup and what constitutes staleness
- **Cleanup_Log**: Audit trail recording all cleanup operations including what was removed, when, and why
- **Active_Task_Index**: The on-chain Vec<u64> tracking currently active task IDs
- **Cancelled_Task**: A task that has been explicitly removed from on-chain storage via cancel_task
- **Paused_Task**: A task with is_active=false that remains in storage but is excluded from execution
- **Abandoned_Task**: A task that has not been executed or updated within a defined time threshold despite being marked active
- **Archival_Storage**: Long-term storage for cleaned records that preserves debugging history without polluting active indexes

## Requirements

### Requirement 1: Define Staleness Criteria

**User Story:** As a system operator, I want clear definitions of what constitutes a stale task record, so that cleanup operations are predictable and safe.

#### Acceptance Criteria

1. THE Cleanup_Service SHALL classify a record as Stale_Record WHEN the task_id exists in Backend_Index but does not exist in on-chain storage (cancelled task)
2. THE Cleanup_Service SHALL classify a record as Stale_Record WHEN the task_id is not present in Active_Task_Index for more than 30 days AND the task is marked paused
3. THE Cleanup_Service SHALL classify a record as Stale_Record WHEN last_run timestamp is more than 90 days old AND gas_balance is zero AND the task is marked active (abandoned task)
4. THE Cleanup_Service SHALL NOT classify a record as Stale_Record IF the task was created within the last 7 days (grace period)
5. WHERE staleness classification is configurable, THE Cleanup_Service SHALL load time thresholds from Retention_Policy configuration

### Requirement 2: Safe Detection Mechanism

**User Story:** As a system operator, I want stale task detection to be safe and non-destructive, so that I can review findings before any data is removed.

#### Acceptance Criteria

1. WHEN Cleanup_Service performs detection, THE Cleanup_Service SHALL query on-chain state for each indexed task_id to verify existence
2. WHEN Cleanup_Service performs detection, THE Cleanup_Service SHALL compare Backend_Index timestamps with current ledger timestamp to calculate staleness duration
3. THE Cleanup_Service SHALL produce a detection report listing all Stale_Record candidates with classification reason and staleness duration
4. THE Cleanup_Service SHALL NOT modify Backend_Index during detection phase
5. WHEN detection encounters on-chain query errors, THE Cleanup_Service SHALL log the error and exclude that task_id from the Stale_Record list
6. THE Cleanup_Service SHALL rate-limit on-chain queries to avoid overwhelming the RPC endpoint (maximum 10 queries per second)

### Requirement 3: Reviewable Cleanup Strategy

**User Story:** As a system operator, I want to review and approve cleanup operations before they execute, so that I can prevent accidental data loss.

#### Acceptance Criteria

1. THE Cleanup_Service SHALL require explicit operator approval before executing cleanup operations
2. WHEN presenting cleanup candidates, THE Cleanup_Service SHALL display task_id, classification reason, staleness duration, last_run timestamp, and gas_balance for each Stale_Record
3. WHERE cleanup is automated, THE Cleanup_Service SHALL enforce a minimum staleness threshold of 30 days before automatic cleanup
4. THE Cleanup_Service SHALL support dry-run mode that simulates cleanup without modifying Backend_Index
5. WHEN operator approves cleanup, THE Cleanup_Service SHALL archive records to Archival_Storage before removal from Backend_Index

### Requirement 4: Preserve Debugging History

**User Story:** As a developer, I want historical task data preserved for debugging, so that I can investigate past issues even after cleanup.

#### Acceptance Criteria

1. WHEN Cleanup_Service removes a Stale_Record from Backend_Index, THE Cleanup_Service SHALL copy the complete record to Archival_Storage
2. THE Archival_Storage SHALL retain records for a minimum of 365 days
3. THE Cleanup_Service SHALL include cleanup timestamp and classification reason in archived records
4. THE Cleanup_Service SHALL preserve all task configuration fields including creator, target, function, args, resolver, interval, last_run, gas_balance, whitelist, is_active, and blocked_by
5. WHERE a task has execution history, THE Cleanup_Service SHALL archive all associated execution logs and events
6. THE Cleanup_Service SHALL support querying Archival_Storage by task_id, creator address, and cleanup timestamp range

### Requirement 5: Cleanup Activity Logging

**User Story:** As a system operator, I want detailed logs of all cleanup operations, so that I can audit what was changed and troubleshoot issues.

#### Acceptance Criteria

1. WHEN Cleanup_Service executes cleanup, THE Cleanup_Service SHALL write an entry to Cleanup_Log for each removed record
2. THE Cleanup_Log entry SHALL include task_id, cleanup timestamp, classification reason, staleness duration, operator identity, and archival location
3. WHEN cleanup fails for a specific record, THE Cleanup_Service SHALL log the error with task_id and failure reason
4. THE Cleanup_Service SHALL emit structured log events in JSON format for integration with log aggregation systems
5. THE Cleanup_Service SHALL calculate and log cleanup metrics including total records scanned, records cleaned, records archived, and operation duration
6. WHERE cleanup is automated, THE Cleanup_Log SHALL distinguish between automatic and manual cleanup operations

### Requirement 6: Cleanup Metrics and Monitoring

**User Story:** As a system operator, I want metrics on cleanup activity, so that I can monitor system health and detect anomalies.

#### Acceptance Criteria

1. THE Cleanup_Service SHALL expose a metric tracking total number of Stale_Record instances detected per cleanup run
2. THE Cleanup_Service SHALL expose a metric tracking total number of records cleaned per cleanup run
3. THE Cleanup_Service SHALL expose a metric tracking cleanup operation duration in milliseconds
4. THE Cleanup_Service SHALL expose a metric tracking Backend_Index size before and after cleanup
5. WHEN cleanup failure rate exceeds 10 percent, THE Cleanup_Service SHALL emit an alert event
6. THE Cleanup_Service SHALL expose metrics in Prometheus format for integration with monitoring systems

### Requirement 7: Retention Policy Configuration

**User Story:** As a system administrator, I want configurable retention policies, so that I can adjust cleanup behavior based on operational needs.

#### Acceptance Criteria

1. THE Retention_Policy SHALL define minimum staleness thresholds for each classification type (cancelled, paused, abandoned)
2. THE Retention_Policy SHALL define grace period duration for newly created tasks (default 7 days)
3. THE Retention_Policy SHALL define archival retention duration (default 365 days)
4. THE Retention_Policy SHALL define automatic cleanup enablement flag (default false)
5. WHEN Retention_Policy is updated, THE Cleanup_Service SHALL reload configuration without restart
6. THE Retention_Policy SHALL be stored in a configuration file with schema validation

### Requirement 8: Idempotent Cleanup Operations

**User Story:** As a system operator, I want cleanup operations to be idempotent, so that running cleanup multiple times does not cause errors or data corruption.

#### Acceptance Criteria

1. WHEN Cleanup_Service attempts to clean a task_id that is already removed from Backend_Index, THE Cleanup_Service SHALL skip the operation without error
2. WHEN Cleanup_Service attempts to archive a task_id that is already in Archival_Storage, THE Cleanup_Service SHALL update the existing archive record with the latest cleanup timestamp
3. THE Cleanup_Service SHALL use transactional operations for Backend_Index modifications to ensure atomicity
4. IF archival fails for a record, THE Cleanup_Service SHALL NOT remove the record from Backend_Index
5. THE Cleanup_Service SHALL verify record existence in Backend_Index before attempting removal

### Requirement 9: Rollback and Recovery

**User Story:** As a system operator, I want the ability to recover from incorrect cleanup operations, so that I can restore accidentally removed data.

#### Acceptance Criteria

1. THE Cleanup_Service SHALL support restoring records from Archival_Storage back to Backend_Index
2. WHEN restoring a record, THE Cleanup_Service SHALL verify the task_id still exists on-chain before restoration
3. THE Cleanup_Service SHALL log all restoration operations to Cleanup_Log with operator identity and reason
4. WHERE a task_id was cleaned but later reappears on-chain, THE Cleanup_Service SHALL automatically restore the archived record to Backend_Index
5. THE Cleanup_Service SHALL support bulk restoration by providing a list of task_ids

### Requirement 10: Property-Based Testing for Cleanup Correctness

**User Story:** As a developer, I want comprehensive property-based tests for cleanup logic, so that I can verify correctness across diverse scenarios.

#### Acceptance Criteria

1. THE Test_Suite SHALL verify the invariant that Backend_Index size never increases after cleanup (monotonic decrease property)
2. THE Test_Suite SHALL verify the invariant that every removed record exists in Archival_Storage (archival completeness property)
3. THE Test_Suite SHALL verify the round-trip property that archived records can be restored to Backend_Index with identical field values
4. THE Test_Suite SHALL verify the idempotence property that running cleanup twice on the same dataset produces identical results
5. THE Test_Suite SHALL generate random task configurations with varying staleness durations and verify classification correctness
6. THE Test_Suite SHALL verify the metamorphic property that cleanup order does not affect final Backend_Index state
7. THE Test_Suite SHALL verify error handling by generating invalid task_ids and confirming graceful failure without data corruption

### Requirement 11: Cleanup Tradeoffs Documentation

**User Story:** As a system administrator, I want documentation of retention and cleanup tradeoffs, so that I can make informed configuration decisions.

#### Acceptance Criteria

1. THE Documentation SHALL explain the storage cost implications of different retention durations
2. THE Documentation SHALL explain the debugging capability tradeoffs of aggressive versus conservative cleanup policies
3. THE Documentation SHALL provide recommended retention thresholds for different deployment scales (small, medium, large)
4. THE Documentation SHALL explain the performance impact of cleanup operations on Backend_Index query latency
5. THE Documentation SHALL document the RPC query cost implications of detection frequency
6. THE Documentation SHALL provide decision trees for choosing between automatic and manual cleanup modes

### Requirement 12: Concurrent Cleanup Safety

**User Story:** As a system operator, I want cleanup operations to be safe when multiple instances run concurrently, so that distributed deployments do not corrupt data.

#### Acceptance Criteria

1. WHEN multiple Cleanup_Service instances run concurrently, THE Cleanup_Service SHALL use distributed locking to ensure only one instance performs cleanup at a time
2. THE Cleanup_Service SHALL acquire a lock with a maximum duration of 30 minutes before starting cleanup
3. IF Cleanup_Service cannot acquire the lock within 5 minutes, THE Cleanup_Service SHALL abort and log a warning
4. WHEN Cleanup_Service completes or fails, THE Cleanup_Service SHALL release the distributed lock
5. THE Cleanup_Service SHALL use lock heartbeat mechanism to detect and recover from crashed instances holding locks

