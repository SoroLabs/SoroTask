'use strict';

/**
 * Prometheus metrics for the ZK proof service (issue #860).
 *
 * Reality note: the current ZKProofService uses a lightweight in-memory worker
 * pool (see index.js) with no real backlog queue -- generateProof acquires an
 * idle worker synchronously and rejects with "Worker pool at capacity" when
 * none is free. These metrics are therefore wired to the ACTUAL execution path
 * in server.js (per-request timing + the worker pool's own status counters)
 * rather than to an invented distributed queue:
 *
 *   zk_worker_pool_active   (gauge)     active workers in the pool
 *   zk_worker_pool_capacity (gauge)     total workers in the pool
 *   zk_proof_duration_ms    (histogram) wall time of generateProof()
 *   zk_queue_wait_ms        (histogram) time a request waited before a worker
 *                                       began executing it (queue-wait proxy)
 *
 * A dedicated Registry is used (not the global default) so tests can create
 * isolated instances without metric-name collisions.
 */

const client = require('prom-client');

function createMetrics() {
  const registry = new client.Registry();

  const workerPoolActive = new client.Gauge({
    name: 'zk_worker_pool_active',
    help: 'Number of active (busy) workers in the ZK proof worker pool',
    registers: [registry],
  });

  const workerPoolCapacity = new client.Gauge({
    name: 'zk_worker_pool_capacity',
    help: 'Total number of workers configured in the ZK proof worker pool',
    registers: [registry],
  });

  const proofDurationMs = new client.Histogram({
    name: 'zk_proof_duration_ms',
    help: 'Duration of ZK proof generation in milliseconds',
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [registry],
  });

  const queueWaitMs = new client.Histogram({
    name: 'zk_queue_wait_ms',
    help: 'Time a proof request waited before a worker began executing it (ms)',
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
    registers: [registry],
  });

  return {
    registry,
    workerPoolActive,
    workerPoolCapacity,
    proofDurationMs,
    queueWaitMs,
  };
}

module.exports = { createMetrics, client };
