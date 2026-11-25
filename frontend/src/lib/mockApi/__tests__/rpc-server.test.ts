import { MockRpcServer } from '../rpc-server';

describe('MockRpcServer', () => {
  let rpc: MockRpcServer;

  beforeEach(() => {
    rpc = new MockRpcServer({ latencyMs: 0 }); // Fast tests
  });

  afterEach(() => {
    rpc.reset();
  });

  it('should call registered handler and return result', async () => {
    rpc.registerHandler('getAccount', (args: { id: string }) => ({ name: 'Test', id: args.id }));
    
    const result = await rpc.call('getAccount', { id: '123' });
    expect(result).toEqual({ name: 'Test', id: '123' });
  });

  it('should throw if method is not found', async () => {
    await expect(rpc.call('nonExistent', {})).rejects.toThrow("RPC Error: Method 'nonExistent' not found.");
  });

  it('should simulate network partition by dropping all requests immediately', async () => {
    rpc.registerHandler('ping', () => 'pong');
    rpc.updateOptions({ state: 'PARTITIONED' });

    await expect(rpc.call('ping', {})).rejects.toThrow('Network Error: Partitioned. RPC Server unreachable.');
  });

  it('should simulate degraded network by throwing random failures (forced 100% for test)', async () => {
    rpc.registerHandler('ping', () => 'pong');
    rpc.updateOptions({ state: 'DEGRADED', failureRate: 1.0 });

    await expect(rpc.call('ping', {})).rejects.toThrow('RPC Error: Random failure during transmission.');
  });

  it('should wrap internal handler errors as RPC Internal Errors', async () => {
    rpc.registerHandler('failMethod', () => { throw new Error('Database down'); });
    
    await expect(rpc.call('failMethod', {})).rejects.toThrow('RPC Internal Error: Database down');
  });

  it('should update options correctly', () => {
    rpc.updateOptions({ latencyMs: 500, state: 'PARTITIONED' });
    expect(rpc.getOptions()).toEqual({
      latencyMs: 500,
      failureRate: 0,
      state: 'PARTITIONED',
    });
  });

  it('should simulate latency', async () => {
    rpc.registerHandler('slow', () => 'done');
    rpc.updateOptions({ latencyMs: 100 });
    
    const start = Date.now();
    const result = await rpc.call('slow', {});
    const end = Date.now();
    
    expect(result).toBe('done');
    expect(end - start).toBeGreaterThanOrEqual(95); // allow tiny variance
  });
});
