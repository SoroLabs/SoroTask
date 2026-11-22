'use strict';

const crypto = require('crypto');
const { createLogger } = require('./logger');

const BATCH_SIZE = 500;
const MAX_TASKS_PER_PROOF = 500;

class MerkleTree {
  constructor(leaves = []) {
    this.leaves = leaves.map((leaf) => this.hash(leaf));
    this.layers = [this.leaves];
    this.build();
  }

  hash(data) {
    if (typeof data === 'string') {
      return crypto.createHash('sha256').update(data).digest('hex');
    }
    return crypto.createHash('sha256').update(Buffer.from(data)).digest('hex');
  }

  build() {
    let currentLayer = this.leaves;
    while (currentLayer.length > 1) {
      const nextLayer = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left;
        nextLayer.push(this.hash(left + right));
      }
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }
  }

  getRoot() {
    return this.layers[this.layers.length - 1][0] || this.hash('');
  }

  getProof(index) {
    const proof = [];
    let currentIndex = index;
    for (let layerIdx = 0; layerIdx < this.layers.length - 1; layerIdx++) {
      const layer = this.layers[layerIdx];
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < layer.length) {
        proof.push({
          hash: layer[siblingIndex],
          position: isRight ? 'left' : 'right',
        });
      }
      currentIndex = Math.floor(currentIndex / 2);
    }
    return proof;
  }

  static verify(root, leaf, proof) {
    let currentHash = typeof leaf === 'string' ? leaf : crypto.createHash('sha256').update(leaf).digest('hex');
    for (const step of proof) {
      if (step.position === 'left') {
        currentHash = crypto.createHash('sha256').update(step.hash + currentHash).digest('hex');
      } else {
        currentHash = crypto.createHash('sha256').update(currentHash + step.hash).digest('hex');
      }
    }
    return currentHash === root;
  }
}

class TaskExecutionBatch {
  constructor() {
    this.executions = [];
    this.batchId = crypto.randomUUID();
    this.createdAt = new Date().toISOString();
  }

  addExecution(execution) {
    if (this.executions.length >= MAX_TASKS_PER_PROOF) {
      throw new Error(`Batch full: max ${MAX_TASKS_PER_PROOF} executions per proof`);
    }

    const record = {
      taskId: execution.taskId,
      contractId: execution.contractId,
      functionName: execution.functionName,
      args: execution.args || [],
      result: execution.result || null,
      status: execution.status,
      timestamp: execution.timestamp || new Date().toISOString(),
      gasUsed: execution.gasUsed || 0,
      success: execution.status === 'completed',
    };

    record.hash = this.hashExecution(record);
    this.executions.push(record);
    return record;
  }

  hashExecution(execution) {
    const payload = JSON.stringify({
      taskId: execution.taskId,
      contractId: execution.contractId,
      functionName: execution.functionName,
      args: execution.args,
      result: execution.result,
      status: execution.status,
      timestamp: execution.timestamp,
      gasUsed: execution.gasUsed,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  getStateRoot() {
    const tree = new MerkleTree(this.executions.map((e) => e.hash));
    return tree.getRoot();
  }

  generateProof() {
    const stateRoot = this.getStateRoot();
    const executionHashes = this.executions.map((e) => e.hash);

    const commitment = crypto.createHash('sha256')
      .update(stateRoot)
      .update(Buffer.from(JSON.stringify(executionHashes)))
      .digest('hex');

    return {
      batchId: this.batchId,
      stateRoot,
      executionCount: this.executions.length,
      commitment,
      timestamp: this.createdAt,
      executions: this.executions,
    };
  }
}

class ZKRollupWorker {
  constructor(options = {}) {
    this.logger = createLogger('zk-rollup-worker');
    this.batchSize = options.batchSize || BATCH_SIZE;
    this.currentBatch = new TaskExecutionBatch();
    this.proofHistory = [];
    this.isProcessing = false;
  }

  async addExecution(execution) {
    const record = this.currentBatch.addExecution(execution);
    this.logger.info('Execution added to batch', {
      batchId: this.currentBatch.batchId,
      taskId: execution.taskId,
      batchSize: this.currentBatch.executions.length,
    });

    if (this.currentBatch.executions.length >= this.batchSize) {
      return this.processBatch();
    }

    return { queued: true, batchId: this.currentBatch.batchId };
  }

  async processBatch() {
    if (this.isProcessing) {
      this.logger.warn('Batch processing already in progress');
      return { queued: true };
    }

    this.isProcessing = true;
    this.logger.info('Processing batch', {
      batchId: this.currentBatch.batchId,
      executionCount: this.currentBatch.executions.length,
    });

    try {
      const proof = this.currentBatch.generateProof();

      const stateTransition = {
        previousStateRoot: this.proofHistory.length > 0
          ? this.proofHistory[this.proofHistory.length - 1].stateRoot
          : crypto.createHash('sha256').update('genesis').digest('hex'),
        newStateRoot: proof.stateRoot,
        batchId: proof.batchId,
        executionCount: proof.executionCount,
        commitment: proof.commitment,
        timestamp: proof.timestamp,
      };

      stateTransition.proofHash = crypto.createHash('sha256')
        .update(stateTransition.previousStateRoot)
        .update(stateTransition.newStateRoot)
        .update(stateTransition.commitment)
        .digest('hex');

      this.proofHistory.push({
        ...proof,
        stateTransition,
      });

      this.logger.info('Batch processed successfully', {
        batchId: proof.batchId,
        stateRoot: proof.stateRoot,
        executionCount: proof.executionCount,
      });

      this.currentBatch = new TaskExecutionBatch();

      return {
        success: true,
        proof,
        stateTransition,
      };
    } catch (error) {
      this.logger.error('Batch processing failed', { error: error.message });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  async forceProcess() {
    if (this.currentBatch.executions.length === 0) {
      this.logger.info('No executions to process');
      return { queued: false };
    }
    return this.processBatch();
  }

  getProof(proofId) {
    return this.proofHistory.find((p) => p.batchId === proofId);
  }

  getLatestProof() {
    return this.proofHistory[this.proofHistory.length - 1] || null;
  }

  getStats() {
    return {
      currentBatchSize: this.currentBatch.executions.length,
      totalProofs: this.proofHistory.length,
      totalExecutions: this.proofHistory.reduce((sum, p) => sum + p.executionCount, 0),
      latestStateRoot: this.getLatestProof()?.stateRoot || null,
    };
  }
}

module.exports = {
  MerkleTree,
  TaskExecutionBatch,
  ZKRollupWorker,
  BATCH_SIZE,
  MAX_TASKS_PER_PROOF,
};
