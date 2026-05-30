# SoroTask Contract Upgrade Guide

## Quick Reference

This guide provides step-by-step instructions for upgrading the SoroTask contract using the proxy pattern.

## Pre-Upgrade Checklist

- [ ] New implementation contract compiled and tested locally
- [ ] All unit tests passing (>90% coverage)
- [ ] Integration tests passing with mainnet state clone
- [ ] Storage compatibility verified
- [ ] Code review completed
- [ ] Security audit finished (if major version)
- [ ] Rollback plan documented
- [ ] Stakeholder notification sent
- [ ] Admin key is secure and available
- [ ] Upgrade timelock (if applicable) scheduled

## Upgrade Steps

### 1. Compile New Implementation

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
```

**Output:** `target/wasm32-unknown-unknown/release/sorotask_impl.wasm`

**Verification:**
```bash
# Check wasm file exists and is valid
wc -c target/wasm32-unknown-unknown/release/sorotask_impl.wasm
```

### 2. Deploy New Implementation Contract

```bash
IMPL_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/sorotask_impl.wasm \
  --source admin-key \
  --network testnet)

echo "Implementation ID: $IMPL_ID"
```

### 3. Verify Implementation Deployment

```bash
# Query implementation contract version (if it has a version function)
soroban contract invoke \
  --id $IMPL_ID \
  --fn get_version \
  --network testnet
```

### 4. Run Compatibility Tests

```bash
# Test backward compatibility with existing data
cargo test -- --nocapture --test-threads=1 proxy_tests

# Verify storage layout
cargo test -- --nocapture --test-threads=1 compatibility_tests
```

### 5. Execute Upgrade on Proxy

```bash
PROXY_ID="your-proxy-contract-id"

# Call upgrade (requires admin signature)
soroban contract invoke \
  --id $PROXY_ID \
  --fn upgrade \
  --arg-xdr $IMPL_ID \
  --source admin-key \
  --network testnet
```

### 6. Verify Upgrade Success

```bash
# Check current implementation
IMPL_INFO=$(soroban contract invoke \
  --id $PROXY_ID \
  --fn get_implementation \
  --network testnet)

echo "Current Implementation: $IMPL_INFO"

# Verify version was incremented
# (should show new version number)
```

### 7. Monitor Upgrade Effects

```bash
# Check for ImplementationUpgraded events
soroban events \
  --id $PROXY_ID \
  --type ImplementationUpgraded \
  --network testnet

# Query recent tasks to verify state intact
# (implementation-specific queries)
```

## Rollback Procedure

In case of critical issues, rollback to previous implementation:

### Quick Rollback

```bash
PREVIOUS_IMPL_ID="previous-implementation-address"

soroban contract invoke \
  --id $PROXY_ID \
  --fn upgrade \
  --arg-xdr $PREVIOUS_IMPL_ID \
  --source admin-key \
  --network testnet

# Verify rollback
soroban contract invoke \
  --id $PROXY_ID \
  --fn get_implementation \
  --network testnet
```

### Post-Rollback Steps

1. Investigate root cause of failure
2. Create issue report with error details
3. Fix bugs in implementation
4. Re-test thoroughly
5. Schedule new upgrade attempt

## Version-Specific Guides

### Upgrade v1 → v2

**What's New:**
- New resolver interface
- Improved gas estimation
- Enhanced error tracking

**Breaking Changes:** None (backward compatible)

**Estimated Time:** 5-10 minutes

**Special Notes:**
- Tasks from v1 work as-is
- New resolver features optional

### Upgrade v2 → v3

**What's New:**
- Multi-chain support
- Distributed locking
- Enhanced security

**Breaking Changes:** None (backward compatible)

**Estimated Time:** 10-15 minutes

**Special Notes:**
- Requires config update
- Cross-chain querying enabled

## Monitoring Dashboard

After upgrade, monitor these metrics:

### Key Metrics

```
Task Registration Rate (should remain stable)
Task Execution Success Rate (should stay >99%)
Average Gas Per Task (may improve with v2+)
Active Tasks Count (should remain unchanged)
```

### Alert Thresholds

- Task failure rate > 5% for 5 minutes → Investigate
- New implementation panics → Rollback
- Storage access errors → Rollback immediately
- Missing events → Check implementation

### Query Monitoring

```bash
# Monitor task count
soroban contract invoke --id proxy-id --fn count_active_tasks

# Check gas statistics
soroban contract invoke --id proxy-id --fn get_gas_stats

# View recent errors
soroban events --id proxy-id --type error --limit 10
```

## Troubleshooting

### Error: "Unauthorized"

**Cause:** Upgrade not signed by admin

**Fix:**
```bash
# Verify admin address
soroban contract invoke \
  --id $PROXY_ID \
  --fn get_admin \
  --network testnet

# Ensure you're signing with correct key
soroban contract invoke \
  --id $PROXY_ID \
  --fn upgrade \
  --arg-xdr $IMPL_ID \
  --source admin-key \  # ← Use correct admin key
  --network testnet
```

### Error: "Incompatible version"

**Cause:** Storage layout incompatible

**Fix:**
1. Review changes in new implementation
2. Verify no fields were removed
3. Check field types unchanged
4. Run compatibility test suite
5. If issues remain, create new implementation

### Error: "Implementation already initialized"

**Cause:** Calling init() on already-initialized proxy

**Fix:**
- Use `upgrade()` for updates, not `init()`
- `init()` only called once at deployment

### Tasks Disappearing After Upgrade

**Cause:** Incorrect storage keys in new implementation

**Fix:**
1. Compare DataKey enum between versions
2. Verify key serialization unchanged
3. Check field order in structures
4. Rollback and investigate

## Safety Procedures

### Pre-Production Upgrade (Recommended)

```bash
# 1. Test on local Soroban environment
soroban deploy --network local

# 2. Test on testnet
soroban deploy --network testnet

# 3. Run full integration tests
cargo test --all --release

# 4. Get community review
# Submit PR and wait for approval

# 5. Finally, upgrade mainnet
soroban deploy --network public
```

### Signing Best Practices

```bash
# Don't sign with online keys
soroban contract invoke \
  --id $PROXY_ID \
  --fn upgrade \
  --arg-xdr $IMPL_ID \
  --source-account /path/to/secure/key \  # ← Offline key
  --network testnet
```

### Change Log Entry

After successful upgrade, document:

```
## Version X.Y.Z - [Date]

### Implementation Upgrade
- Previous Implementation: [address]
- New Implementation: [address]
- Proxy Version: [version number]

### Changes
- Feature 1: Description
- Fix 1: Description
- Optimization 1: Description

### Migration Notes
- State preserved: ✓
- Backward compatible: ✓
- Breaking changes: None

### Test Results
- Unit tests: PASSED
- Integration tests: PASSED
- Gas optimization: [% improvement]
- Storage compatibility: VERIFIED
```

## Automation Possibilities

### Scheduled Upgrades

```bash
# Use cron or scheduler
0 3 * * 0 /usr/local/bin/sorotask-upgrade.sh

# Script checks:
# 1. New version available
# 2. All safety checks passed
# 3. Execute upgrade
# 4. Verify success
```

### Multi-sig Governance

```
Community proposes upgrade → Voting period → 
Multi-sig threshold met → Upgrade executed
```

### Automated Rollback

```
Monitor error rate → If > 5% → Rollback to previous
Alert admins → Manual investigation required
```

## Contact & Support

**For Upgrade Issues:**
- GitHub Issues: https://github.com/SoroLabs/SoroTask/issues
- Discord: #sorotask-upgrades
- Email: upgrade-support@sorolabs.io

**Upgrade Coordinator:** [TBD]

**Emergency Rollback Contact:** [TBD]

---

**Last Updated:** 2026-05-30
**Version:** 1.0
**Status:** Ready for v1→v2 upgrade
