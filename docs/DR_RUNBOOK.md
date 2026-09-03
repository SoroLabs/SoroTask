# SoroTask Disaster Recovery & Point-in-Time Recovery (PITR) Runbook

## Overview
This runbook provides step-by-step instructions for performing automated database backups, continuous Write-Ahead Log (WAL) archiving, Point-in-Time Recovery (PITR), and disaster recovery drills for SoroTask production databases.

## Service Level Objectives (SLOs)
- **Recovery Point Objective (RPO)**: < 5 minutes (Maximum acceptable data loss window).
- **Recovery Time Objective (RTO)**: < 15 minutes (Maximum acceptable downtime during restoration).

---

## 1. Automated Backup Architecture

### Daily Base Snapshots
- Base snapshots are generated daily at `02:00 UTC` using `scripts/backup/db_pitr_backup.sh`.
- Snapshots are compressed with `gzip` and uploaded to `s3://sorotask-db-backups/snapshots/`.
- Retention Policy: 30 days automatic retention.

### Continuous WAL Archiving
- PostgreSQL / DB Write-Ahead Logs (WAL) are shipped continuously as segments are filled to `s3://sorotask-db-backups/wal/`.
- Archiving frequency: Continuous (or maximum 60-second window).

---

## 2. Emergency Disaster Recovery Procedure (PITR)

When database corruption or accidental data deletion occurs, follow these steps to perform Point-in-Time Recovery:

### Step 1: Declare Incident & Stop Writing Services
```bash
# Scale down API services to prevent new incoming writes
docker-compose stop indexer keeper
```

### Step 2: Determine Recovery Target Timestamp
Identify the exact UTC timestamp immediately prior to the incident (e.g., `2026-08-26T14:00:00Z`).

### Step 3: Run Automated Recovery Script
Execute the disaster recovery drill script with your target timestamp:
```bash
./scripts/backup/dr_restore_drill.sh "2026-08-26T14:00:00Z"
```

### Step 4: Verify Restored Data Integrity
Validate state consistency using indexer and keeper verification checks:
```bash
# Verify restored indexer database schema and latest synced ledger
sqlite3 /tmp/sorotask_dr_restore/restored_sorotask.db "SELECT count(*) FROM tasks;"
```

### Step 5: Promote Restored Database & Restart Services
```bash
# Replace target database with restored file
cp /tmp/sorotask_dr_restore/restored_sorotask.db indexer/indexer.db
docker-compose start indexer keeper
```

---

## 3. Automated DR Restoration Drill Verification

To execute an automated restoration drill and verify RTO SLA compliance:
```bash
./scripts/backup/dr_restore_drill.sh
```
Expected output: `✓ RTO SLA PASSED: Restoration completed in < 15 minutes`.
