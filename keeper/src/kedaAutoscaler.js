const fs = require('fs');
const path = require('path');

/**
 * KEDA Event-Driven Autoscaler & Helm Chart Validator (#1437).
 *
 * Monitors Redis due-task backlog depth and Soroban network transaction volume
 * to compute desired Keeper pod replicas (bounded between minReplicas=3 and maxReplicas=50)
 * within a <= 15-second trigger window.
 */
class KedaEventAutoscaler {
  /**
   * @param {object} [options]
   * @param {number} [options.minReplicas=3]
   * @param {number} [options.maxReplicas=50]
   * @param {number} [options.pollingIntervalSeconds=5]
   * @param {number} [options.targetBacklogPerPod=10]
   * @param {number} [options.targetTxVolumePerPod=50]
   */
  constructor(options = {}) {
    this.minReplicas = options.minReplicas ?? 3;
    this.maxReplicas = options.maxReplicas ?? 50;
    this.pollingIntervalSeconds = options.pollingIntervalSeconds ?? 5;
    this.targetBacklogPerPod = options.targetBacklogPerPod ?? 10;
    this.targetTxVolumePerPod = options.targetTxVolumePerPod ?? 50;
    this.currentReplicas = options.initialReplicas ?? this.minReplicas;
  }

  /**
   * Compute desired pod count based on Redis task backlog depth and network tx volume.
   * @param {object} metrics
   * @param {number} [metrics.redisBacklogDepth=0]
   * @param {number} [metrics.pendingDueTasks=0]
   * @param {number} [metrics.networkTxVolume=0]
   * @returns {object}
   */
  evaluateScaling(metrics = {}) {
    const redisBacklog = Math.max(0, Number(metrics.redisBacklogDepth) || 0);
    const pendingDue = Math.max(0, Number(metrics.pendingDueTasks) || 0);
    const txVolume = Math.max(0, Number(metrics.networkTxVolume) || 0);

    const effectiveBacklog = Math.max(redisBacklog, pendingDue);
    const replicasFromBacklog = Math.ceil(effectiveBacklog / this.targetBacklogPerPod);
    const replicasFromTxVolume = Math.ceil(txVolume / this.targetTxVolumePerPod);

    const rawDesired = Math.max(this.minReplicas, replicasFromBacklog, replicasFromTxVolume);
    const desiredReplicas = Math.min(this.maxReplicas, Math.max(this.minReplicas, rawDesired));

    const scaled = desiredReplicas !== this.currentReplicas;
    const previousReplicas = this.currentReplicas;
    this.currentReplicas = desiredReplicas;

    return {
      previousReplicas,
      desiredReplicas,
      scaled,
      triggerLatencySeconds: this.pollingIntervalSeconds,
      withinSlaTriggerWindow: this.pollingIntervalSeconds <= 15,
      signals: {
        redisBacklog,
        pendingDue,
        txVolume,
        replicasFromBacklog,
        replicasFromTxVolume,
      },
    };
  }
}

/**
 * Validate production Dockerfile and Helm chart structure (`charts/sorotask-keeper`).
 * Ensures Helm lint rules, KEDA ScaledObject triggers, HPA bounds (3..50),
 * secrets management, and graceful pod termination hooks are valid.
 *
 * @param {string} [repoRoot]
 * @returns {{ valid: boolean, errors: string[], details: object }}
 */
function lintHelmChartAndDockerfile(repoRoot = path.resolve(__dirname, '../..')) {
  const errors = [];
  const chartDir = path.join(repoRoot, 'charts', 'sorotask-keeper');
  const dockerfilePath = path.join(repoRoot, 'Dockerfile');
  const keeperDockerfilePath = path.join(repoRoot, 'keeper', 'Dockerfile');

  const requiredFiles = [
    dockerfilePath,
    keeperDockerfilePath,
    path.join(chartDir, 'Chart.yaml'),
    path.join(chartDir, 'values.yaml'),
    path.join(chartDir, 'templates', '_helpers.tpl'),
    path.join(chartDir, 'templates', 'deployment.yaml'),
    path.join(chartDir, 'templates', 'service.yaml'),
    path.join(chartDir, 'templates', 'secret.yaml'),
    path.join(chartDir, 'templates', 'hpa.yaml'),
    path.join(chartDir, 'templates', 'keda-scaledobject.yaml'),
  ];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing required file: ${path.relative(repoRoot, filePath)}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, details: {} };
  }

  const chartYaml = fs.readFileSync(path.join(chartDir, 'Chart.yaml'), 'utf8');
  const valuesYaml = fs.readFileSync(path.join(chartDir, 'values.yaml'), 'utf8');
  const deploymentYaml = fs.readFileSync(path.join(chartDir, 'templates', 'deployment.yaml'), 'utf8');
  const kedaYaml = fs.readFileSync(path.join(chartDir, 'templates', 'keda-scaledobject.yaml'), 'utf8');
  const hpaYaml = fs.readFileSync(path.join(chartDir, 'templates', 'hpa.yaml'), 'utf8');
  const secretYaml = fs.readFileSync(path.join(chartDir, 'templates', 'secret.yaml'), 'utf8');
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

  if (!chartYaml.includes('apiVersion: v2') || !chartYaml.includes('name: sorotask-keeper')) {
    errors.push('Chart.yaml must declare apiVersion: v2 and name: sorotask-keeper');
  }

  if (!valuesYaml.includes('minReplicaCount: 3') || !valuesYaml.includes('maxReplicaCount: 50')) {
    errors.push('values.yaml must configure KEDA minReplicaCount: 3 and maxReplicaCount: 50');
  }

  const pollingMatch = valuesYaml.match(/pollingInterval:\s*(\d+)/);
  const pollingInterval = pollingMatch ? parseInt(pollingMatch[1], 10) : 999;
  if (pollingInterval > 15) {
    errors.push(`KEDA pollingInterval (${pollingInterval}s) must be <= 15s to trigger within 15 seconds`);
  }

  if (!deploymentYaml.includes('terminationGracePeriodSeconds') || !deploymentYaml.includes('preStop')) {
    errors.push('deployment.yaml must configure terminationGracePeriodSeconds and lifecycle.preStop hook');
  }

  if (!kedaYaml.includes('kind: ScaledObject') || !kedaYaml.includes('type: redis') || !kedaYaml.includes('type: prometheus')) {
    errors.push('keda-scaledobject.yaml must define ScaledObject with redis and prometheus triggers');
  }

  if (!hpaYaml.includes('kind: HorizontalPodAutoscaler')) {
    errors.push('hpa.yaml must define HorizontalPodAutoscaler resource');
  }

  if (!secretYaml.includes('kind: Secret') || !secretYaml.includes('KEEPER_SECRET')) {
    errors.push('secret.yaml must manage KEEPER_SECRET and runtime credentials');
  }

  if (!dockerfile.includes('STOPSIGNAL SIGTERM') || !dockerfile.includes('HEALTHCHECK')) {
    errors.push('Dockerfile must configure STOPSIGNAL SIGTERM and HEALTHCHECK');
  }

  return {
    valid: errors.length === 0,
    errors,
    details: {
      chartName: 'sorotask-keeper',
      minReplicas: 3,
      maxReplicas: 50,
      pollingIntervalSeconds: pollingInterval,
    },
  };
}

module.exports = {
  KedaEventAutoscaler,
  lintHelmChartAndDockerfile,
};
