function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeAdaptivePollingInterval(inputs, previousIntervalMs) {
  const {
    baseIntervalMs,
    minIntervalMs,
    maxIntervalMs,
    backlogSize,
    dueCount,
    dueSoonCount,
    minSecondsUntilDue,
    avgRpcLatencyMs,
    cycleDurationMs,
    errors,
  } = inputs;

  let nextIntervalMs = baseIntervalMs;
  const reasons = [];

  if (dueCount > 0) {
    nextIntervalMs = Math.min(nextIntervalMs, Math.max(minIntervalMs, 1000));
    reasons.push('due_tasks_ready');
  }

  if (dueSoonCount > 0) {
    nextIntervalMs = Math.min(nextIntervalMs, Math.max(minIntervalMs, 2000));
    reasons.push('upcoming_due_window');
  }

  if (Number.isFinite(minSecondsUntilDue) && minSecondsUntilDue > 0) {
    const proactiveTarget = Math.floor(minSecondsUntilDue * 1000 * 0.5);
    nextIntervalMs = Math.min(nextIntervalMs, Math.max(minIntervalMs, proactiveTarget));
    reasons.push('align_to_next_due');
  }

  if (backlogSize >= 200) {
    nextIntervalMs *= 0.35;
    reasons.push('large_backlog');
  } else if (backlogSize >= 50) {
    nextIntervalMs *= 0.6;
    reasons.push('medium_backlog');
  } else if (backlogSize <= 5) {
    nextIntervalMs *= 1.2;
    reasons.push('low_backlog');
  }

  if (avgRpcLatencyMs >= 3000) {
    nextIntervalMs *= 1.9;
    reasons.push('very_high_rpc_latency');
  } else if (avgRpcLatencyMs >= 1500) {
    nextIntervalMs *= 1.5;
    reasons.push('high_rpc_latency');
  } else if (avgRpcLatencyMs >= 800) {
    nextIntervalMs *= 1.2;
    reasons.push('elevated_rpc_latency');
  }

  if (cycleDurationMs > nextIntervalMs * 0.8) {
    nextIntervalMs *= 1.2;
    reasons.push('long_cycle_duration');
  }

  if (errors > 0) {
    nextIntervalMs *= 1 + Math.min(errors, 5) * 0.1;
    reasons.push('error_backoff');
  }

  nextIntervalMs = clamp(Math.round(nextIntervalMs), minIntervalMs, maxIntervalMs);

  if (Number.isFinite(previousIntervalMs) && previousIntervalMs > 0) {
    // Smooth sudden jumps to prevent oscillation.
    const lowerBound = Math.max(minIntervalMs, Math.round(previousIntervalMs * 0.5));
    const upperBound = Math.min(maxIntervalMs, Math.round(previousIntervalMs * 2));
    nextIntervalMs = clamp(nextIntervalMs, lowerBound, upperBound);
  }

  return {
    intervalMs: nextIntervalMs,
    reasons,
  };
}

function computeNextExecutionTime(task, nowMs) {
  if (!task || typeof task !== 'object') {
    return null;
  }

  const candidates = [];

  if (Number.isFinite(task.nextExecutionTime)) {
    candidates.push(task.nextExecutionTime);
  }

  if (Number.isFinite(task.nextExecutionMs)) {
    candidates.push(task.nextExecutionMs);
  }

  if (Number.isFinite(task.executionTime)) {
    candidates.push(task.executionTime);
  }

  if (Number.isFinite(task.intervalMs) && task.intervalMs > 0) {
    const base = Number.isFinite(task.lastExecutedAt) ? task.lastExecutedAt : nowMs;
    candidates.push(base + task.intervalMs);
  }

  if (candidates.length === 0) {
    return null;
  }

  return Math.min(...candidates);
}

class MinHeap {
  constructor(compare) {
    this.compare = compare || ((a, b) => a < b);
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  isEmpty() {
    return this.items.length === 0;
  }

  peek() {
    return this.items[0];
  }

  push(item) {
    this.items.push(item);
    this._siftUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) {
      return undefined;
    }
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  _siftUp(index) {
    const item = this.items[index];
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = this.items[parentIndex];
      if (this.compare(item, parent) >= 0) {
        break;
      }
      this.items[index] = parent;
      index = parentIndex;
    }
    this.items[index] = item;
  }

  _siftDown(index) {
    const length = this.items.length;
    const item = this.items[index];
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;
      let smallest = item;

      if (leftIndex < length && this.compare(this.items[leftIndex], smallest) < 0) {
        smallest = this.items[leftIndex];
        smallestIndex = leftIndex;
      }

      if (rightIndex < length && this.compare(this.items[rightIndex], smallest) < 0) {
        smallest = this.items[rightIndex];
        smallestIndex = rightIndex;
      }

      if (smallestIndex === index) {
        break;
      }

      this.items[index] = smallest;
      index = smallestIndex;
    }
    this.items[index] = item;
  }
}

class AdaptivePollerSleeper {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.setTimeout = options.setTimeout || setTimeout;
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : 250;
    this.maxIntervalMs = Number.isFinite(options.maxIntervalMs) ? options.maxIntervalMs : 60 * 60 * 1000;
    this.heap = new MinHeap((a, b) => a.nextExecutionTime - b.nextExecutionTime);
    this.timer = null;
    this.running = false;
    this.generation = 0;
  }

  schedule(tasks, onDue) {
    this.cancel();
    this.heap = new MinHeap((a, b) => a.nextExecutionTime - b.nextExecutionTime);
    const nowMs = this.now();
    const list = Array.isArray(tasks) ? tasks : [];
    for (const task of list) {
      const nextExecutionTime = computeNextExecutionTime(task, nowMs);
      if (nextExecutionTime === null) {
        continue;
      }
      this.heap.push({ task, nextExecutionTime });
    }
    this.onDue = typeof onDue === 'function' ? onDue : () => {};
    this.running = true;
    this.generation += 1;
    this._scheduleNext(this.generation);
  }

  cancel() {
    this.running = false;
    this.generation += 1;
    if (this.timer) {
      this.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _scheduleNext(generation) {
    if (!this.running || generation !== this.generation) {
      return;
    }

    if (this.heap.isEmpty()) {
      this.running = false;
      return;
    }

    const nowMs = this.now();
    const next = this.heap.peek();
    const delayMs = Math.max(this.minIntervalMs, Math.min(this.maxIntervalMs, next.nextExecutionTime - nowMs));

    this.timer = this.setTimeout(() => {
      this.timer = null;
      this._onTimer(generation);
    }, delayMs);

    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  _onTimer(generation) {
    if (!this.running || generation !== this.generation) {
      return;
    }

    const nowMs = this.now();
    const due = [];
    while (!this.heap.isEmpty()) {
      const top = this.heap.peek();
      if (top.nextExecutionTime > nowMs) {
        break;
      }
      due.push(this.heap.pop());
    }

    if (due.length > 0) {
      this.onDue(due.map((entry) => entry.task), due);
    }

    this._scheduleNext(generation);
  }
}

function addJitter(intervalMs, jitterMs, random = Math.random) {
  const base = Number.isFinite(intervalMs) ? intervalMs : 0;
  const amplitude = Number.isFinite(jitterMs) ? Math.max(0, jitterMs) : 0;
  if (amplitude === 0) {
    return Math.round(base);
  }
  const offset = Math.floor((random() * 2 - 1) * amplitude + 0.5);
  return Math.round(base + offset);
}

module.exports = {
  computeAdaptivePollingInterval,
  computeNextExecutionTime,
  MinHeap,
  AdaptivePollerSleeper,
  addJitter,
};
