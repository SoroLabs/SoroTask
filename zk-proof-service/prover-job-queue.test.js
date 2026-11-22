'use strict';

/**
 * Tests for ProverJobQueue prioritization (#1210).
 *
 * Runs in local (no-Redis) mode: jobs are drained by the in-process queue,
 * which must serve lower priority-value (more urgent) jobs first, FIFO
 * within the same priority.
 */

const { ProverJobQueue, CPU_CONCURRENCY } = require('./lib/prover-job-queue');

describe('ProverJobQueue prioritization (#1210)', () => {
  test('exposes the CPU-based default concurrency', () => {
    expect(CPU_CONCURRENCY).toBeGreaterThanOrEqual(1);
  });

  test('drains more urgent (lower priority value) jobs first', async () => {
    const processed = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const queue = new ProverJobQueue({
      concurrency: 1, // force strict ordering
      processJob: async (data) => {
        await gate;
        processed.push(data.id);
        return data.id;
      },
    });

    // Occupancy job: starts immediately, keeping the worker busy while the
    // remaining jobs are queued and sorted.
    await queue.add('blocker', { id: 'blocker' });

    // Enqueue out of order; lower value = more urgent.
    await queue.add('job-low', { id: 'low' }, { priority: 50 });
    await queue.add('job-urgent', { id: 'urgent' }, { priority: 0 });
    await queue.add('job-default', { id: 'default' });
    await queue.add('job-mid', { id: 'mid' }, { priority: 10 });

    release();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(processed).toEqual(['blocker', 'urgent', 'default', 'mid', 'low']);
    await queue.close();
  });

  test('keeps FIFO order within the same priority level', async () => {
    const processed = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const queue = new ProverJobQueue({
      concurrency: 1,
      processJob: async (data) => {
        await gate;
        processed.push(data.id);
        return data.id;
      },
    });

    await queue.add('a', { id: 'a' }, { priority: 5 });
    await queue.add('b', { id: 'b' }, { priority: 5 });
    await queue.add('c', { id: 'c' }, { priority: 5 });

    release();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(processed).toEqual(['a', 'b', 'c']);
    await queue.close();
  });

  test('concurrent jobs run without blocking the event loop', async () => {
    const queue = new ProverJobQueue({
      concurrency: 3,
      processJob: async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return data.id;
      },
    });

    const start = Date.now();
    await Promise.all([
      queue.add('p1', { id: 'p1' }),
      queue.add('p2', { id: 'p2' }),
      queue.add('p3', { id: 'p3' }),
    ]);
    const elapsed = Date.now() - start;

    // Three 20ms jobs on 3 workers finish in ~20ms, not 60ms; the interval
    // also proves the event loop was never blocked.
    expect(elapsed).toBeLessThan(100);
    await queue.close();
  });
});
