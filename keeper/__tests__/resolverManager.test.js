const path = require('path');
const { ResolverManager } = require('../src/resolverManager');

describe('ResolverManager', () => {
  const pluginPath = path.resolve(__dirname, 'fixtures', 'simple-resolver.js');
  const config = {
    resolvers: {
      simple: {
        path: pluginPath,
        options: { reject: false },
      },
      rejecter: {
        path: pluginPath,
        options: { reject: true },
      },
    },
  };

  it('loads resolver plugins from config', async () => {
    const manager = new ResolverManager({ timeoutMs: 1000, maxConcurrent: 2 });
    await manager.loadPluginsFromConfig(config, process.cwd());

    expect(manager.getResolver('simple')).not.toBeNull();
    expect(manager.getResolver('rejecter')).not.toBeNull();
  });

  it('resolves a positive plugin result', async () => {
    const manager = new ResolverManager({ timeoutMs: 1000, maxConcurrent: 1 });
    await manager.loadPluginsFromConfig(config, process.cwd());

    const result = await manager.resolve(1, 'simple', { target: 'T' });
    expect(result).toEqual({ isReady: true });
  });

  it('propagates resolver reject reasons', async () => {
    const manager = new ResolverManager({ timeoutMs: 1000, maxConcurrent: 1 });
    await manager.loadPluginsFromConfig(config, process.cwd());

    const result = await manager.resolve(2, 'rejecter', { target: 'T' });
    expect(result).toEqual({ isReady: false, reason: 'explicit_reject' });
  });

  it('returns false when a resolver times out', async () => {
    const timeoutConfig = {
      resolvers: {
        slow: {
          path: pluginPath,
          options: { timeout: 200 },
        },
      },
    };

    const manager = new ResolverManager({ timeoutMs: 50, maxConcurrent: 1 });
    await manager.loadPluginsFromConfig(timeoutConfig, process.cwd());

    const result = await manager.resolve(3, 'slow', { target: 'T' });
    expect(result).toEqual({ isReady: false, reason: 'resolver_timeout' });
  });
});
