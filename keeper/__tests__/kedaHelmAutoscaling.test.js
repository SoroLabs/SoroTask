const { KedaEventAutoscaler, lintHelmChartAndDockerfile } = require('../src/kedaAutoscaler');

describe('BE-PROD-13 (#1437): Production Kubernetes Helm Charts, HPA & KEDA Event-Driven Scaling', () => {
  test('Helm chart, KEDA ScaledObject, HPA, Secret, and Dockerfile pass lint cleanly', () => {
    const report = lintHelmChartAndDockerfile();
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.details.minReplicas).toBe(3);
    expect(report.details.maxReplicas).toBe(50);
    expect(report.details.pollingIntervalSeconds).toBeLessThanOrEqual(15);
  });

  test('KEDA autoscaler scales pods dynamically between 3 and 50 replicas within 15s of task queue spikes', () => {
    const scaler = new KedaEventAutoscaler({
      minReplicas: 3,
      maxReplicas: 50,
      pollingIntervalSeconds: 5,
      targetBacklogPerPod: 10,
      targetTxVolumePerPod: 50,
    });

    // Idle state stays at minimum 3 replicas
    const idleResult = scaler.evaluateScaling({
      redisBacklogDepth: 5,
      pendingDueTasks: 4,
      networkTxVolume: 20,
    });
    expect(idleResult.desiredReplicas).toBe(3);
    expect(idleResult.withinSlaTriggerWindow).toBe(true);
    expect(idleResult.triggerLatencySeconds).toBeLessThanOrEqual(15);

    // Sudden Redis due-task backlog spike (240 tasks -> 24 replicas)
    const spikeResult = scaler.evaluateScaling({
      redisBacklogDepth: 240,
      pendingDueTasks: 200,
      networkTxVolume: 400,
    });
    expect(spikeResult.desiredReplicas).toBe(24);
    expect(spikeResult.scaled).toBe(true);

    // Massive network surge caps at maxReplicas = 50
    const surgeResult = scaler.evaluateScaling({
      redisBacklogDepth: 800,
      pendingDueTasks: 750,
      networkTxVolume: 4000,
    });
    expect(surgeResult.desiredReplicas).toBe(50);
  });
});
