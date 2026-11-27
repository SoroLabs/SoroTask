const {
  DisasterRecoveryOrchestrator,
  DNSFailoverOrchestrator,
  CrossCloudStateReplicator,
} = require('../src/dr-orchestrator');
const { ExecutionCoordinator } = require('../src/coordinator');

describe('BE-FINAL-35: Disaster Recovery Orchestrator (RPO < 10s, RTO < 60s, Zero-Touch Drills)', () => {
  test('executes automated Cloudflare DNS failover with CNAME payload and proxied TTL', async () => {
    const calls = [];
    const dns = new DNSFailoverOrchestrator({
      dnsProvider: 'cloudflare',
      domainName: 'api.sorotask.io',
      cloudflareZoneId: 'zone-123',
      cloudflareRecordId: 'rec-456',
      cloudflareProxied: true,
      cloudflareRequestFn: async (req) => {
        calls.push(req);
        return { success: true };
      },
    });

    const result = await dns.updateDNSRecord(
      { url: 'https://aws-primary.sorotask.io', region: 'us-east-1' },
      { url: 'https://gcp-standby.sorotask.io', region: 'us-central1' }
    );

    expect(result.success).toBe(true);
    expect(result.provider).toBe('cloudflare');
    expect(result.dryRun).toBe(false);
    expect(result.target).toBe('gcp-standby.sorotask.io');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      zoneId: 'zone-123',
      recordId: 'rec-456',
      payload: {
        type: 'CNAME',
        name: 'api.sorotask.io',
        content: 'gcp-standby.sorotask.io',
        ttl: 1,
        proxied: true,
      },
    });
  });

  test('falls back to dry-run Cloudflare DNS failover when credentials are not configured', async () => {
    const dns = new DNSFailoverOrchestrator({
      dnsProvider: 'cloudflare',
      domainName: 'api.sorotask.io',
      cloudflareApiToken: null,
      cloudflareZoneId: null,
      cloudflareRecordId: null,
    });

    const result = await dns.updateDNSRecord(
      { url: 'https://aws-primary.sorotask.io', region: 'us-east-1' },
      { url: 'https://gcp-standby.sorotask.io', region: 'us-central1' }
    );

    expect(result.success).toBe(true);
    expect(result.provider).toBe('cloudflare');
    expect(result.dryRun).toBe(true);
    expect(result.target).toBe('gcp-standby.sorotask.io');
  });

  test('passes automated zero-operator-intervention DR drill with RPO < 10s and RTO < 60s', async () => {
    const promotedRegions = [];
    const revivedRegions = [];
    const cloudflareCalls = [];

    const endpoints = [
      { index: 0, cloud: 'aws', region: 'us-east-1', url: 'https://aws-keeper.sorotask.io' },
      { index: 1, cloud: 'gcp', region: 'us-central1', url: 'https://gcp-keeper.sorotask.io' },
    ];

    const orchestrator = new DisasterRecoveryOrchestrator(endpoints, {
      dnsProvider: 'cloudflare',
      domainName: 'keeper.sorotask.io',
      cloudflareZoneId: 'zone-dr',
      cloudflareRecordId: 'rec-dr',
      cloudflareRequestFn: async (req) => {
        cloudflareCalls.push(req);
        return { success: true };
      },
      dbPromotionHook: async (standby) => {
        promotedRegions.push(standby.region);
      },
      keeperRevivalHook: async (standby) => {
        revivedRegions.push(standby.region);
      },
    });

    const standbyCoordinator = new ExecutionCoordinator();
    standbyCoordinator.attachDrOrchestrator(orchestrator, 'gcp');

    const report = await orchestrator.runDrDrill({
      coordinator: standbyCoordinator,
      restoreStateAfterDrill: true,
    });

    expect(report.passed).toBe(true);
    expect(report.zeroOperatorIntervention).toBe(true);
    expect(report.rpoMs).toBeLessThan(10000);
    expect(report.rtoMs).toBeLessThan(60000);
    expect(report.rpoCompliant).toBe(true);
    expect(report.rtoCompliant).toBe(true);
    expect(report.splitBrainPrevented).toBe(true);
    expect(report.dbPromotion.success).toBe(true);
    expect(report.dnsFailover.success).toBe(true);
    expect(report.dnsFailover.provider).toBe('cloudflare');
    expect(report.keeperRevival.success).toBe(true);

    expect(promotedRegions).toEqual(['us-central1']);
    expect(revivedRegions).toEqual(['us-central1']);
    expect(cloudflareCalls).toHaveLength(1);

    // Pre-drill state is cleanly restored
    expect(orchestrator.currentPrimary.cloud).toBe('aws');
    expect(orchestrator.clusterEpoch).toBe(1);
    expect(orchestrator.fencedClusters.size).toBe(0);
  });

  test('stress test: sustains RPO < 10s and RTO < 60s across rapid mutations and repeated DR drills', async () => {
    const replicator = new CrossCloudStateReplicator({
      rpoTargetMs: 5000,
    });

    const baseTime = Date.now();
    for (let i = 1; i <= 50; i += 1) {
      const sync = replicator.recordPrimaryMutation(
        {
          fencingTokens: { [`task-${i}`]: i },
          tasks: { [`task-${i}`]: { status: 'active' } },
          latestLedger: 100000 + i,
          timestamp: baseTime + i * 10,
        },
        true
      );
      expect(sync.rpoMs).toBeLessThan(10000);
      expect(sync.withinRpoTarget).toBe(true);
    }

    const orchestrator = new DisasterRecoveryOrchestrator(
      [
        { index: 0, cloud: 'aws', region: 'us-east-1', url: 'https://aws-keeper.sorotask.io' },
        { index: 1, cloud: 'gcp', region: 'us-central1', url: 'https://gcp-keeper.sorotask.io' },
      ],
      {
        stateReplicator: replicator,
        dnsProvider: 'cloudflare',
      }
    );

    for (let drill = 0; drill < 5; drill += 1) {
      const report = await orchestrator.runDrDrill({
        now: baseTime + 60000 * (drill + 1),
        restoreStateAfterDrill: true,
      });
      expect(report.passed).toBe(true);
      expect(report.rpoMs).toBeLessThan(10000);
      expect(report.rtoMs).toBeLessThan(60000);
      expect(report.splitBrainPrevented).toBe(true);
    }
  });
});
