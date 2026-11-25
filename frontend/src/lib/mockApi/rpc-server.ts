export type NetworkState = 'CONNECTED' | 'PARTITIONED' | 'DEGRADED';

export interface RpcServerOptions {
  latencyMs: number;
  failureRate: number; // 0 to 1
  state: NetworkState;
}

export type RpcHandler<TArgs = any, TResult = any> = (args: TArgs) => Promise<TResult> | TResult;

export class MockRpcServer {
  private options: RpcServerOptions = {
    latencyMs: 100,
    failureRate: 0,
    state: 'CONNECTED',
  };

  private handlers = new Map<string, RpcHandler>();

  constructor(options?: Partial<RpcServerOptions>) {
    if (options) {
      this.updateOptions(options);
    }
  }

  public updateOptions(options: Partial<RpcServerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  public getOptions(): Readonly<RpcServerOptions> {
    return this.options;
  }

  public registerHandler<TArgs, TResult>(method: string, handler: RpcHandler<TArgs, TResult>): void {
    this.handlers.set(method, handler);
  }

  public async call<TResult = any, TArgs = any>(method: string, args: TArgs): Promise<TResult> {
    if (this.options.state === 'PARTITIONED') {
      throw new Error('Network Error: Partitioned. RPC Server unreachable.');
    }

    // Simulate latency
    let delay = this.options.latencyMs;
    if (this.options.state === 'DEGRADED') {
      delay += Math.random() * 2000; // Random spike in latency up to 2 seconds
    }
    
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (this.options.state === 'DEGRADED' || this.options.failureRate > 0) {
      const effectiveFailureRate = this.options.state === 'DEGRADED' ? Math.max(0.5, this.options.failureRate) : this.options.failureRate;
      if (Math.random() < effectiveFailureRate) {
        throw new Error('RPC Error: Random failure during transmission.');
      }
    }

    const handler = this.handlers.get(method);
    if (!handler) {
      throw new Error(`RPC Error: Method '${method}' not found.`);
    }

    try {
      return await handler(args);
    } catch (err: any) {
      // Wrap internal handler errors as RPC errors
      throw new Error(`RPC Internal Error: ${err.message || String(err)}`);
    }
  }

  public reset(): void {
    this.options = {
      latencyMs: 100,
      failureRate: 0,
      state: 'CONNECTED',
    };
    this.handlers.clear();
  }
}

// Export a singleton instance for ease of use in tests
export const mockRpcServer = new MockRpcServer();
