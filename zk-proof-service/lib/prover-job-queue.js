'use strict';

const os = require('os');

const CPU_CONCURRENCY = Math.max(1, os.cpus().length - 1);

class ProverJobQueue {
  constructor(options = {}) {
    this.concurrency = options.concurrency ?? CPU_CONCURRENCY;
    this.processJob = options.processJob;
    this.onProgress = options.onProgress ?? (() => {});
    this.onComplete = options.onComplete ?? (() => {});
    this.onError = options.onError ?? (() => {});
    this.localQueue = [];
    this.localActive = 0;
    this.queue = null;
    this.worker = null;

    if (options.redisUrl) {
      let Queue;
      let Worker;
      try {
        ({ Queue, Worker } = require('bullmq'));
      } catch (error) {
        throw new Error(`Redis prover queue requires BullMQ: ${error.message}`);
      }

      const connection = { url: options.redisUrl };
      const queueName = options.queueName ?? 'zk-proof-jobs';
      this.queue = new Queue(queueName, { connection });
      this.worker = new Worker(
        queueName,
        async (job) => this.processJob(job.data, (progress) => {
          this.onProgress(job.id, progress);
          return job.updateProgress(progress);
        }),
        { connection, concurrency: this.concurrency },
      );
      this.worker.on('completed', (job, result) => this.onComplete(job.id, result));
      this.worker.on('failed', (job, error) => this.onError(job?.id, error));
    }
  }

  async add(id, data) {
    if (this.queue) {
      await this.queue.add('prove', data, {
        jobId: id,
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      });
      return;
    }

    this.localQueue.push({ id, data });
    this._drainLocal();
  }

  async get(id) {
    if (!this.queue) return null;
    const job = await this.queue.getJob(id);
    if (!job) return null;
    const state = await job.getState();
    return {
      jobId: id,
      status: state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : state === 'active' ? 'processing' : 'queued',
      progress: typeof job.progress === 'number' ? job.progress : 0,
      result: job.returnvalue ?? null,
      error: job.failedReason ?? null,
      createdAt: new Date(job.timestamp).toISOString(),
    };
  }

  _drainLocal() {
    while (this.localActive < this.concurrency && this.localQueue.length > 0) {
      const job = this.localQueue.shift();
      this.localActive += 1;
      Promise.resolve()
        .then(() => this.processJob(job.data, (progress) => this.onProgress(job.id, progress)))
        .then((result) => this.onComplete(job.id, result))
        .catch((error) => this.onError(job.id, error))
        .finally(() => {
          this.localActive -= 1;
          this._drainLocal();
        });
    }
  }

  async close() {
    await Promise.all([
      this.worker?.close(),
      this.queue?.close(),
    ]);
  }
}

module.exports = { ProverJobQueue, CPU_CONCURRENCY };
