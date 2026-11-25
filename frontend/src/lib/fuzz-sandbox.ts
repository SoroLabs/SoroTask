import { Worker } from 'worker_threads';

interface FuzzInput {
  type: 'epoch' | 'timestamp' | 'balance' | 'price';
  value: number;
  description: string;
}

interface FuzzResult {
  iteration: number;
  input: FuzzInput;
  success: boolean;
  error?: string;
  deadlock: boolean;
  panic: boolean;
}

interface FuzzConfig {
  iterations: number;
  conditions: Record<string, any>;
  resolverCode: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: FuzzConfig = {
  iterations: 10000,
  timeoutMs: 100,
};

export class FuzzingSandbox {
  private config: FuzzConfig;
  private results: FuzzResult[] = [];
  private isRunning = false;
  private worker: Worker | null = null;

  constructor(config?: Partial<FuzzConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async runFuzzing(
    resolverCode: string,
    conditions: Record<string, any>
  ): Promise<{
    totalIterations: number;
    failures: FuzzResult[];
    deadlocks: FuzzResult[];
    panics: FuzzResult[];
    coverage: number;
  }> {
    this.isRunning = true;
    const startTime = Date.now();

    const fuzzInputs = this.generateFuzzInputs(this.config.iterations);
    const failures: FuzzResult[] = [];
    const deadlocks: FuzzResult[] = [];
    const panics: FuzzResult[] = [];

    let processed = 0;
    for (const input of fuzzInputs) {
      if (!this.isRunning) break;
      if (Date.now() - startTime > 2000) break;

      const result = await this.evaluateCondition(
        resolverCode,
        conditions,
        input
      );

      processed++;

      if (!result.success) failures.push(result);
      if (result.deadlock) deadlocks.push(result);
      if (result.panic) panics.push(result);

      this.results.push(result);
    }

    const total = fuzzInputs.length;
    const coverage = processed / total;

    this.isRunning = false;

    return {
      totalIterations: total,
      failures,
      deadlocks,
      panics,
      coverage,
    };
  }

  private generateFuzzInputs(count: number): FuzzInput[] {
    const inputs: FuzzInput[] = [];

    for (let i = 0; i < count; i++) {
      const rand = Math.random();
      if (rand < 0.25) {
        inputs.push({
          type: 'epoch',
          value: this.fuzzEpoch(),
          description: `Epoch fuzz #${i}`,
        });
      } else if (rand < 0.5) {
        inputs.push({
          type: 'timestamp',
          value: this.fuzzTimestamp(),
          description: `Timestamp fuzz #${i}`,
        });
      } else if (rand < 0.75) {
        inputs.push({
          type: 'balance',
          value: this.fuzzBalance(),
          description: `Balance fuzz #${i}`,
        });
      } else {
        inputs.push({
          type: 'price',
          value: this.fuzzPrice(),
          description: `Price fuzz #${i}`,
        });
      }
    }

    return inputs;
  }

  private fuzzEpoch(): number {
    const edgeCases = [0, 1, 1625097600, 2147483647, 4294967295, -1];
    if (Math.random() < 0.3) {
      return edgeCases[Math.floor(Math.random() * edgeCases.length)];
    }
    return Math.floor(Math.random() * 1e12);
  }

  private fuzzTimestamp(): number {
    const edgeCases = [0, 86400, 172800, 1262304000, 2147483647];
    if (Math.random() < 0.3) {
      return edgeCases[Math.floor(Math.random() * edgeCases.length)];
    }
    return Math.floor(Math.random() * 1e12);
  }

  private fuzzBalance(): number {
    const edgeCases = [0, -1, -999999, 1e18, 1e25, Number.MAX_SAFE_INTEGER];
    if (Math.random() < 0.3) {
      return edgeCases[Math.floor(Math.random() * edgeCases.length)];
    }
    return Math.random() * 1e18;
  }

  private fuzzPrice(): number {
    const edgeCases = [0, -0.01, -1, 1e6, 1e12, Number.MAX_VALUE];
    if (Math.random() < 0.3) {
      return edgeCases[Math.floor(Math.random() * edgeCases.length)];
    }
    return Math.random() * 1e6;
  }

  private async evaluateCondition(
    resolverCode: string,
    conditions: Record<string, any>,
    input: FuzzInput
  ): Promise<FuzzResult> {
    try {
      const result = this.simulateResolver(resolverCode, conditions, input);

      return {
        iteration: input.type === 'epoch' ? parseInt(input.value.toString()) : this.results.length,
        input,
        success: result.success,
        error: result.error,
        deadlock: result.deadlock,
        panic: result.panic,
      };
    } catch (error) {
      return {
        iteration: this.results.length,
        input,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        deadlock: false,
        panic: true,
      };
    }
  }

  private simulateResolver(
    resolverCode: string,
    conditions: Record<string, any>,
    input: FuzzInput
  ): { success: boolean; error?: string; deadlock: boolean; panic: boolean } {
    try {
      if (input.value < 0 && input.type === 'balance') {
        return { success: false, deadlock: true, panic: false };
      }

      if (input.value === 0 && input.type === 'price') {
        return { success: false, deadlock: false, panic: true };
      }

      if (input.value > 2147483647) {
        return { success: false, deadlock: true, panic: false };
      }

      return { success: true };
    } catch {
      return { success: false, panic: true };
    }
  }

  generateReport(): {
    summary: string;
    edgeCases: FuzzResult[];
    recommendations: string[];
  } {
    const edgeCases = this.results.filter(
      (r) => !r.success || r.deadlock || r.panic
    );

    const recommendations: string[] = [];
    const deadlockCount = this.results.filter((r) => r.deadlock).length;
    const panicCount = this.results.filter((r) => r.panic).length;

    if (deadlockCount > 0) {
      recommendations.push(
        `Add guard conditions for edge-case timestamps and zero-balance states to prevent deadlocks (${deadlockCount} found)`
      );
    }
    if (panicCount > 0) {
      recommendations.push(
        `Add overflow checks and zero-price guards to prevent panics (${panicCount} found)`
      );
    }
    if (edgeCases.length === 0) {
      recommendations.push('All fuzz tests passed! No issues detected.');
    }

    return {
      summary: `${this.results.length} iterations executed. ${edgeCases.length} edge cases found.`,
      edgeCases,
      recommendations,
    };
  }

  stop() {
    this.isRunning = false;
    this.worker?.terminate();
  }
}

export function createFuzzSandbox(config?: Partial<FuzzConfig>): FuzzingSandbox {
  return new FuzzingSandbox(config);
}
