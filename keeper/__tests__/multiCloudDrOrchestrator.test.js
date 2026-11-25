const {
  DisasterRecoveryOrchestrator,
  CrossCloudStateReplicator,
  QuorumHeartbeatMonitor,
} = require('../src/dr-orchestrator');
const { ExecutionCoordinator } = require('../src/coordinator');

describe('BE-PROD-14 (#1438): Disaster Recovery Multi-Cloud Failover Orchestrator (AWS to GCP)', () => {
  test('maintains cross-cloud state replication with RPO < 5s (< 5000ms)', () => {
    const replicator = new CrossCloudStateReplicator({
      sourceCloud: 'aws',
      targetCloud: 'gcp',
      rpoTargetMs: 5000,
    });

    const t0 = Date.now();
    const syncResult = replicator.recordPrimaryMutation(
      {
        fencingTokens: { 'task-1': 14, 'task-2': 9 },
        tasks: { 'task-1': { status: 'running' } },
        latestLedger: 98123,
        timestamp: t0,
      },
      true
    );

    expect(syncResult.withinRpoTarget).toBe(true);
    expect(syncResult.rpoMs).toBeLessThan(5000);

    const snapshot = replicator.getStandbySnapshot();
    expect(snapshot.fencingTokens['task-1']).toBe(14);
    expect(snapshot.latestLedger).toBe(98123);
  });

  test('triggers AWS -> GCP promotion after 15s quorum heartbeat outage with RTO < 30s and zero split-brain conflicts', async () => {
    const endpoints = [
      { index: 0, cloud: 'aws', region: 'us-east-1', url: 'https://aws-keeper.sorotask.io' },
      { index: 1, cloud: 'gcp', region: 'us-central1', url: 'https://gcp-keeper.sorotask.io' },
    ];

    const drOrchestrator = new DisasterRecoveryOrchestrator(endpoints, {
      outageDetectionWindowMs: 15000,
      rpoTargetMs: 5000,
      rtoTargetMs: 30000,
      quorumSize: 2,
    });

    const awsCoordinator = new ExecutionCoordinator();
    const gcpCoordinator = new ExecutionCoordinator();

    awsCoordinator.attachDrOrchestrator(drOrchestrator, 'aws');
    gcpCoordinator.attachDrOrchestrator(drOrchestrator, 'gcp');

    // AWS primary records fencing tokens and replicates to GCP standby
    awsCoordinator.registerLock('task-55', 42, 'aws-lock-55');
    awsCoordinator.syncStateToDrReplicator(105000);

    const t0 = Date.now();

    // At t0: AWS fails quorum probes (2 of 3 probes fail), outage timer starts (0ms < 15000ms)
    const firstCheck = await drOrchestrator.evaluateAndFailover({
      probeVotes: [false, false, true],
      now: t0,
      coordinator: gcpCoordinator,
    });
    expect(firstCheck.failedOver).toBe(false);

    // At t0 + 10s: still under 15s threshold
    const secondCheck = await drOrchestrator.evaluateAndFailover({
      probeVotes: [false, false, false],
      now: t0 + 10000,
      coordinator: gcpCoordinator,
    });
    expect(secondCheck.failedOver).toBe(false);

    // Refresh cross-cloud state replication 2 seconds before failover (RPO = 2000ms < 5000ms)
    drOrchestrator.stateReplicator.replicateNow(t0 + 13500);

    // At t0 + 15.5s: quorum confirms 15s AWS outage -> autonomous failover promotes GCP
    const failoverRecord = await drOrchestrator.evaluateAndFailover({
      probeVotes: [false, false, false],
      now: t0 + 15500,
      coordinator: gcpCoordinator,
    });

    expect(failoverRecord.fromCloud).toBe('aws');
    expect(failoverRecord.toCloud).toBe('gcp');
    expect(failoverRecord.rpoMs).toBeLessThan(5000);
    expect(failoverRecord.rtoMs).toBeLessThan(30000);
    expect(failoverRecord.rpoCompliant).toBe(true);
    expect(failoverRecord.rtoCompliant).toBe(true);
    expect(failoverRecord.splitBrainConflicts).toBe(0);

    // Verify zero dual-active split-brain: fenced AWS primary is rejected immediately
    expect(() => awsCoordinator.assertNoSplitBrainConflict('aws', 1)).toThrow(/SPLIT_BRAIN_FENCED/);

    // Promoted GCP cluster is active at epoch 2 and inherited fencing token watermarks
    expect(gcpCoordinator.assertNoSplitBrainConflict('gcp', 2)).toBe(true);
    expect(gcpCoordinator.getHighestFencingToken('task-55')).toBe(42);
    expect(gcpCoordinator.isFencingTokenValid('task-55', 41)).toBe(false);
  });

  test('QuorumHeartbeatMonitor resets outage timer when cluster recovers before 15s threshold', async () => {
    const monitor = new QuorumHeartbeatMonitor({ outageDetectionWindowMs: 15000, quorumSize: 2 });
    const endpoint = { cloud: 'aws', url: 'https://aws-keeper.sorotask.io' };
    const t0 = Date.now();

    const degraded = await monitor.evaluateClusterHealth(endpoint, {
      probeVotes: [false, false, true],
      now: t0,
    });
    expect(degraded.healthy).toBe(false);

    const recovered = await monitor.evaluateClusterHealth(endpoint, {
      probeVotes: [true, true, false],
      now: t0 + 8000,
    });
    expect(recovered.healthy).toBe(true);
    expect(recovered.outageDurationMs).toBe(0);
    expect(recovered.shouldFailover).toBe(false);
  });
});
