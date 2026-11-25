import { NETWORKS, getNetworkConfig, partitionCacheKey } from '../config';

describe('Network Config & Cache Partitioning', () => {
  it('should resolve default network to testnet', () => {
    const config = getNetworkConfig('unknown_id');
    expect(config.id).toBe('testnet');
    expect(config.isTestnet).toBe(true);
  });

  it('should correctly configure standalone, testnet, futurenet, and mainnet', () => {
    expect(NETWORKS.standalone.isTestnet).toBe(true);
    expect(NETWORKS.testnet.isTestnet).toBe(true);
    expect(NETWORKS.futurenet.isTestnet).toBe(true);
    expect(NETWORKS.mainnet.isTestnet).toBe(false);
  });

  it('should isolate cache keys per network partition', () => {
    const key1 = partitionCacheKey('tasks_list', 'testnet');
    const key2 = partitionCacheKey('tasks_list', 'mainnet');
    const key3 = partitionCacheKey('tasks_list', 'standalone');

    expect(key1).toBe('testnet:tasks_list');
    expect(key2).toBe('mainnet:tasks_list');
    expect(key3).toBe('standalone:tasks_list');
    expect(key1).not.toBe(key2);
  });
});
