# Implementation Plan: Stale Task Cleanup

## Overview

This implementation plan breaks down the Stale Task Cleanup feature into discrete coding tasks. The feature provides safe, auditable detection and cleanup of stale task records from backend indexes while preserving debugging history through archival storage.

**Implementation Language:** Python

**Key Components:**
- Data models and database schemas (PostgreSQL)
- Configuration management with JSON schema validation
- Core cleanup components (Detection Engine, Staleness Classifier, Archival Manager, Cleanup Executor, Distributed Lock Manager)
- RPC integration with SoroTask contract
- Metrics and logging infrastructure (Prometheus, structured JSON logging)
- CLI interface for manual operations
- Property-based tests (22 properties)
- Integration tests
- Documentation and deployment artifacts

## Tasks

- [ ] 1. Set up project structure and dependencies
  - Create Python project structure with src/ directory
  - Set up pyproject.toml with dependencies: SQLAlchemy, psycopg2, redis, prometheus-client, stellar-sdk, pydantic, click, pytest, hypothesis
  - Create requirements.txt and requirements-dev.txt
  - Set up logging configuration with structured JSON output
  - Create .env.example for configuration
  - _Requirements: All (foundational)_

- [ ] 2. Implement data models and database schemas
  - [ ] 2.1 Create SQLAlchemy models for Backend_Index
    - Define BackendTask model with all fields (task_id, creator, target, function, args, resolver, interval, last_run, gas_balance, whitelist, is_active, blocked_by, created_at, updated_at, indexed_at)
    - Add indexes on last_run, is_active, gas_balance, created_at
    - Implement JSON serialization for args, whitelist, blocked_by fields
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_
  
  - [ ] 2.2 Create SQLAlchemy models for Archival_Storage
    - Define ArchivedTask model with all task fields plus cleanup metadata (archive_id, cleanup_timestamp, classification_reason, staleness_duration_days, operator_identity, archival_location)
    - Define ArchivedTaskExecution model for execution history
    - Add indexes on task_id, creator, cleanup_timestamp, classification_reason
    - _Requirements: 4.1, 4.3, 4.4, 4.5_
  
  - [ ] 2.3 Create SQLAlchemy models for Cleanup_Log
    - Define CleanupLog model with all required fields (log_id, task_id, cleanup_timestamp, classification_reason, staleness_duration_days, operator_identity, archival_location, operation_type, operation_mode, success, error_message, detection_duration_ms, archival_duration_ms, cleanup_duration_ms)
    - Define CleanupMetrics model for aggregate metrics
    - Add indexes on task_id, cleanup_timestamp, operation_type, success
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_
  
  - [ ] 2.4 Create Alembic migrations for all schemas
    - Set up Alembic for database migrations
    - Create initial migration for all three schemas (backend_tasks, archived_tasks, archived_task_executions, cleanup_log, cleanup_metrics)
    - Add migration script for indexes
    - _Requirements: All data model requirements_

- [ ] 3. Implement configuration management
  - [ ] 3.1 Create Pydantic models for Retention_Policy configuration
    - Define StalenessThresholds model (cancelled_task_days, paused_task_days, abandoned_task_days)
    - Define RetentionPolicy model with all configuration fields
    - Implement JSON schema validation with constraints (minimum values, defaults)
    - Add configuration file loading from JSON with validation
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_
  
  - [ ] 3.2 Implement configuration hot-reload mechanism
    - Add file watcher for configuration changes
    - Implement thread-safe configuration reload without service restart
    - Add logging for configuration changes
    - _Requirements: 7.5_

- [ ] 4. Implement RPC client for SoroTask contract
  - [ ] 4.1 Create SoroTaskContractClient class
    - Implement get_task(task_id) method using stellar-sdk
    - Implement get_active_task_ids() method
    - Implement get_ledger_timestamp() method
    - Add error handling for RPC failures
    - _Requirements: 2.1, 2.5_
  
  - [ ] 4.2 Implement rate limiting for RPC queries
    - Create RateLimiter class with token bucket algorithm
    - Implement wait_if_needed() async method
    - Make rate limit configurable (default 10 QPS)
    - Add metrics for rate limiting (tokens available, wait time)
    - _Requirements: 2.6_

- [ ] 5. Implement Staleness Classifier
  - [ ] 5.1 Create StalenessClassifier class
    - Implement classify_record() method with all staleness criteria
    - Implement grace period enforcement (default 7 days)
    - Define StalenessClassification enum (Cancelled, PausedStale, Abandoned)
    - Add classification reason string generation
    - Calculate staleness duration in days
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  
  - [ ]* 5.2 Write property test for staleness classification
    - **Property 1: Staleness Classification Correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
    - Generate random task records with varying timestamps, gas balances, active states
    - Verify classification matches expected category based on thresholds
    - Test grace period enforcement
    - _Requirements: 10.5_

- [ ] 6. Implement Detection Engine
  - [ ] 6.1 Create DetectionEngine class
    - Implement detect_stale_records() method
    - Fetch all records from Backend_Index
    - Query on-chain state for each task_id with rate limiting
    - Use StalenessClassifier to classify records
    - Generate DetectionReport with stale records and errors
    - Handle RPC query errors gracefully (log and continue)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_
  
  - [ ]* 6.2 Write property test for detection non-destructiveness
    - **Property 2: Detection Non-Destructiveness**
    - **Validates: Requirements 2.4**
    - Generate random Backend_Index states
    - Capture state snapshot before detection
    - Run detection
    - Verify Backend_Index state unchanged
    - _Requirements: 10.1_
  
  - [ ]* 6.3 Write property test for detection report completeness
    - **Property 3: Detection Report Completeness**
    - **Validates: Requirements 2.3, 3.2**
    - Generate detection runs with varying numbers of stale records
    - Verify each stale record contains all required fields
    - Verify no null or missing fields
    - _Requirements: 10.5_

- [ ] 7. Implement Archival Manager
  - [ ] 7.1 Create ArchivalManager class
    - Implement archive_task() method to copy task to Archival_Storage
    - Preserve all task configuration fields
    - Add cleanup metadata (cleanup_timestamp, classification_reason, staleness_duration_days, operator_identity)
    - Archive execution history if present
    - Return archival location identifier
    - Handle duplicate archival (update existing record)
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 8.2_
  
  - [ ] 7.2 Implement archival query methods
    - Implement get_archived_task(task_id) method
    - Implement query_archived_tasks() method with filters (task_ids, creator, timestamp range, classification, limit)
    - Return complete archived records with metadata
    - _Requirements: 4.6_
  
  - [ ]* 7.3 Write property test for archival completeness
    - **Property 6: Archival Completeness - Field Preservation**
    - **Validates: Requirements 4.1, 4.3, 4.4**
    - Generate random task records with all fields populated
    - Archive each record
    - Retrieve from Archival_Storage
    - Verify all original fields match exactly
    - Verify metadata fields present and valid
    - _Requirements: 10.2_
  
  - [ ]* 7.4 Write property test for execution history preservation
    - **Property 7: Execution History Preservation**
    - **Validates: Requirements 4.5**
    - Generate tasks with varying numbers of execution history entries
    - Archive tasks
    - Verify all execution history entries preserved
    - _Requirements: 10.2_
  
  - [ ]* 7.5 Write property test for archival query correctness
    - **Property 8: Archival Query Correctness**
    - **Validates: Requirements 4.6**
    - Generate random archived records
    - Execute queries with various criteria
    - Verify results match criteria exactly (no false positives/negatives)
    - _Requirements: 10.5_

- [ ] 8. Implement Distributed Lock Manager
  - [ ] 8.1 Create DistributedLockManager class with Redis backend
    - Implement acquire_lock() method with timeout
    - Implement release_lock() method
    - Implement heartbeat mechanism to maintain lock
    - Use Redis SET with NX and PX for atomic lock acquisition
    - Handle lock timeout and expiration
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  
  - [ ] 8.2 Add lock recovery for crashed instances
    - Implement lock expiration detection
    - Add automatic lock release on timeout
    - Log lock recovery events
    - _Requirements: 12.5_

- [ ] 9. Implement Cleanup Executor
  - [ ] 9.1 Create CleanupExecutor class
    - Implement execute_cleanup() method
    - Acquire distributed lock before cleanup
    - Implement cleanup_single_record() method (archive then remove)
    - Enforce transactional operations (archival must succeed before removal)
    - Handle idempotent cleanup (skip already-cleaned records)
    - Write entries to Cleanup_Log for each operation
    - Release lock on completion or failure
    - _Requirements: 3.1, 3.5, 8.1, 8.3, 8.4, 8.5, 12.1, 12.4_
  
  - [ ] 9.2 Implement dry-run mode
    - Add dry_run parameter to execute_cleanup()
    - Log what would be cleaned without modifying Backend_Index
    - Return simulated CleanupResult
    - _Requirements: 3.4_
  
  - [ ] 9.3 Implement approval enforcement
    - Add approval requirement for manual cleanup mode
    - Enforce minimum staleness threshold (30 days) for automatic cleanup
    - Log operator identity for all approved operations
    - _Requirements: 3.1, 3.3_
  
  - [ ]* 9.4 Write property test for cleanup ordering
    - **Property 4: Cleanup Ordering - Archival Before Removal**
    - **Validates: Requirements 3.5**
    - Generate random cleanup operations
    - Track operation ordering
    - Verify archival timestamp < removal timestamp
    - Simulate archival failures and verify removal doesn't occur
    - _Requirements: 10.5_
  
  - [ ]* 9.5 Write property test for dry-run non-destructiveness
    - **Property 5: Dry-Run Non-Destructiveness**
    - **Validates: Requirements 3.4**
    - Generate random cleanup requests with dry_run=true
    - Capture Backend_Index state before operation
    - Run dry-run cleanup
    - Verify Backend_Index state unchanged
    - _Requirements: 10.5_
  
  - [ ]* 9.6 Write property test for cleanup idempotence
    - **Property 12: Cleanup Idempotence**
    - **Validates: Requirements 8.1, 8.2, 8.5, 10.4**
    - Generate random cleanup datasets
    - Run cleanup operation twice
    - Verify second operation is no-op with no errors
    - Verify final states identical
    - _Requirements: 10.4_
  
  - [ ]* 9.7 Write property test for transactional atomicity
    - **Property 13: Transactional Atomicity**
    - **Validates: Requirements 8.3, 8.4**
    - Generate cleanup operations
    - Simulate archival failures at random points
    - Verify Backend_Index unchanged when archival fails
    - Verify no orphaned removals
    - _Requirements: 10.7_

- [ ] 10. Implement restoration functionality
  - [ ] 10.1 Add restore_records() method to CleanupExecutor
    - Verify task_id exists on-chain before restoration
    - Restore archived record to Backend_Index
    - Log restoration operations to Cleanup_Log
    - Support bulk restoration by task_id list
    - Handle restoration failures gracefully
    - _Requirements: 9.1, 9.2, 9.3, 9.5_
  
  - [ ] 10.2 Implement automatic restoration on task re-registration
    - Create EventListener class to listen for TaskRegistered events
    - Check if task_id was previously cleaned
    - Automatically restore from archive if found
    - Log automatic restoration
    - _Requirements: 9.4_
  
  - [ ]* 10.3 Write property test for restoration round-trip
    - **Property 14: Restoration Round-Trip**
    - **Validates: Requirements 9.1, 10.3**
    - Generate random task records
    - Archive, clean, then restore
    - Verify restored record matches original exactly
    - _Requirements: 10.3_
  
  - [ ]* 10.4 Write property test for restoration validation
    - **Property 15: Restoration Validation**
    - **Validates: Requirements 9.2**
    - Generate restoration requests with varying on-chain states
    - Verify restoration succeeds only when task exists on-chain
    - Verify graceful failure when task doesn't exist on-chain
    - _Requirements: 10.5_
  
  - [ ]* 10.5 Write property test for restoration logging
    - **Property 16: Restoration Logging Completeness**
    - **Validates: Requirements 9.3**
    - Generate restoration operations with varying outcomes
    - Verify each operation produces log entry
    - Verify log entries contain all required fields
    - _Requirements: 10.5_
  
  - [ ]* 10.6 Write property test for bulk restoration
    - **Property 17: Bulk Restoration Correctness**
    - **Validates: Requirements 9.5**
    - Generate bulk restoration requests with mixed valid/invalid task_ids
    - Verify all valid task_ids restored
    - Verify invalid task_ids skipped with error logging
    - _Requirements: 10.5_

- [ ] 11. Implement metrics and logging infrastructure
  - [ ] 11.1 Create MetricsCollector class with Prometheus integration
    - Implement metrics for detection (records_scanned, stale_records_found, errors, duration)
    - Implement metrics for cleanup (records_cleaned, records_archived, records_failed, duration, backend_index_size)
    - Implement metrics for restoration (records_restored, records_failed, duration)
    - Implement metrics for lock operations (acquisition_duration, failures, held_duration)
    - Expose metrics in Prometheus format on /metrics endpoint
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  
  - [ ] 11.2 Implement structured JSON logging
    - Configure Python logging to output JSON format
    - Add context fields to all log messages (component, operation, timestamp, level)
    - Implement log levels (DEBUG, INFO, WARN, ERROR, ALERT)
    - Add correlation IDs for tracking operations
    - _Requirements: 5.4_
  
  - [ ] 11.3 Implement alert mechanism for high failure rate
    - Calculate failure rate after each cleanup run
    - Emit alert event when failure rate exceeds 10%
    - Add alert metric to Prometheus
    - _Requirements: 6.5_
  
  - [ ]* 11.4 Write property test for cleanup logging completeness
    - **Property 9: Cleanup Logging Completeness**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.6**
    - Generate cleanup operations with varying outcomes
    - Verify log entry count matches record count
    - Verify each log entry contains all required fields
    - _Requirements: 10.5_
  
  - [ ]* 11.5 Write property test for metrics calculation correctness
    - **Property 10: Metrics Calculation Correctness**
    - **Validates: Requirements 5.5, 6.1, 6.2, 6.3, 6.4**
    - Generate cleanup runs with varying outcomes
    - Count actual operations performed
    - Verify metrics match actual counts
    - _Requirements: 10.5_
  
  - [ ]* 11.6 Write property test for alert threshold correctness
    - **Property 11: Alert Threshold Correctness**
    - **Validates: Requirements 6.5**
    - Generate cleanup runs with varying failure rates
    - Verify alert emitted when failure_rate > 10%
    - Verify no alert when failure_rate ≤ 10%
    - _Requirements: 10.5_

- [ ] 12. Implement CLI interface
  - [ ] 12.1 Create CLI using Click framework
    - Implement `cleanup detect` command to run detection and display report
    - Implement `cleanup execute` command to run cleanup with approval prompt
    - Implement `cleanup restore` command to restore archived tasks
    - Implement `cleanup config` command to display current configuration
    - Add --dry-run flag for execute command
    - Add --auto-approve flag for execute command (bypass approval)
    - Add --task-ids flag for restore command (bulk restoration)
    - _Requirements: 3.1, 3.4_
  
  - [ ] 12.2 Add CLI output formatting
    - Format detection report as table with task_id, classification, staleness_duration, reason
    - Format cleanup result with summary statistics
    - Add colored output for success/failure/warning messages
    - Add progress bars for long-running operations
    - _Requirements: 3.2_

- [ ] 13. Write integration tests
  - [ ]* 13.1 Write end-to-end cleanup workflow test
    - Populate Backend_Index with test tasks
    - Simulate on-chain state (cancelled, paused, abandoned tasks)
    - Run detection and verify report accuracy
    - Execute cleanup and verify records archived and removed
    - Verify cleanup log entries
    - _Requirements: All_
  
  - [ ]* 13.2 Write restoration workflow test
    - Archive and clean test tasks
    - Restore tasks and verify records reappear in Backend_Index
    - Verify restoration log entries
    - _Requirements: 9.1, 9.2, 9.3, 9.5_
  
  - [ ]* 13.3 Write concurrent cleanup safety test
    - Start multiple cleanup instances simultaneously
    - Verify only one acquires lock
    - Verify others abort gracefully
    - Verify no data corruption
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ] 14. Write remaining property-based tests
  - [ ]* 14.1 Write property test for backend index monotonic decrease
    - **Property 18: Backend Index Monotonic Decrease**
    - **Validates: Requirements 10.1**
    - Generate random Backend_Index states
    - Capture size before cleanup
    - Run cleanup
    - Verify size_after ≤ size_before
    - _Requirements: 10.1_
  
  - [ ]* 14.2 Write property test for archival completeness invariant
    - **Property 19: Archival Completeness Invariant**
    - **Validates: Requirements 10.2**
    - Generate cleanup operations
    - Track all task_ids removed from Backend_Index
    - Verify each removed task_id exists in Archival_Storage
    - _Requirements: 10.2_
  
  - [ ]* 14.3 Write property test for cleanup order independence
    - **Property 20: Cleanup Order Independence**
    - **Validates: Requirements 10.6**
    - Generate set of stale records
    - Run cleanup with records in random order A
    - Reset and run cleanup with different random order B
    - Verify final states identical
    - _Requirements: 10.6_
  
  - [ ]* 14.4 Write property test for error handling safety
    - **Property 21: Error Handling Safety**
    - **Validates: Requirements 10.7**
    - Generate cleanup operations
    - Inject random errors (invalid task_ids, RPC failures, database errors)
    - Verify graceful error handling without crashes
    - Verify data consistency (no orphaned/partial/duplicate records)
    - _Requirements: 10.7_
  
  - [ ]* 14.5 Write property test for lock release guarantee
    - **Property 22: Lock Release Guarantee**
    - **Validates: Requirements 12.4**
    - Generate cleanup operations with varying outcomes
    - Verify lock released in all cases (success, failure, timeout)
    - Use mock lock backend to track acquire/release calls
    - _Requirements: 12.4_

- [ ] 15. Create documentation
  - [ ] 15.1 Write operational runbook
    - Document daily operations (monitoring checklist, routine tasks)
    - Document troubleshooting guide (high failure rate, slow cleanup, lock timeout, storage growth)
    - Document configuration tuning (conservative, aggressive, balanced policies)
    - Include example commands and expected outputs
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  
  - [ ] 15.2 Write configuration guide
    - Document all configuration options with descriptions
    - Provide example configurations for different deployment scales
    - Explain tradeoffs (storage cost vs debugging capability, cleanup frequency vs RPC cost)
    - Include decision trees for choosing automatic vs manual mode
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  
  - [ ] 15.3 Write API documentation
    - Document all public classes and methods with docstrings
    - Generate API documentation using Sphinx
    - Include usage examples for each component
    - _Requirements: All_

- [ ] 16. Create deployment artifacts
  - [ ] 16.1 Create Dockerfile for cleanup service
    - Multi-stage build with Python 3.11+
    - Install all dependencies
    - Copy source code and configuration
    - Set up entrypoint for CLI
    - Optimize image size
    - _Requirements: All_
  
  - [ ] 16.2 Create Docker Compose configuration
    - Define services: cleanup-service, postgres, redis
    - Configure environment variables
    - Set up volumes for persistent storage
    - Add health checks
    - _Requirements: All_
  
  - [ ] 16.3 Create Kubernetes manifests
    - Create Deployment for cleanup service
    - Create ConfigMap for retention policy
    - Create Secret for database credentials
    - Create Service for metrics endpoint
    - Create CronJob for scheduled cleanup (automatic mode)
    - _Requirements: All_
  
  - [ ] 16.4 Create configuration templates
    - Create retention_policy.json template with comments
    - Create .env template with all required variables
    - Create example configurations (conservative, aggressive, balanced)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 17. Set up monitoring and alerting
  - [ ] 17.1 Create Grafana dashboard for cleanup metrics
    - Add panels for detection metrics (records scanned, stale records found, errors)
    - Add panels for cleanup metrics (records cleaned, failure rate, duration)
    - Add panels for backend index size over time
    - Add panels for lock operations
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [ ] 17.2 Create Prometheus alerting rules
    - Alert on high failure rate (>10%)
    - Alert on cleanup duration exceeding threshold
    - Alert on lock acquisition failures
    - Alert on archival storage growth rate
    - _Requirements: 6.5_

- [ ] 18. Final checkpoint - Ensure all tests pass
  - Run all unit tests, property-based tests, and integration tests
  - Verify test coverage meets minimum threshold (80%+)
  - Run linting and type checking (mypy, pylint, black)
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property-based tests use Hypothesis library to generate random test cases
- Integration tests require Docker for running PostgreSQL and Redis
- All database operations use SQLAlchemy ORM for portability
- RPC client uses stellar-sdk for Stellar network integration
- Distributed locking uses Redis by default (can be swapped for PostgreSQL advisory locks or etcd)
- CLI uses Click framework for user-friendly command-line interface
- Metrics use prometheus-client library for Prometheus integration
- Logging uses Python's built-in logging with JSON formatter
- Configuration uses Pydantic for validation and type safety
- All async operations use asyncio for concurrency
