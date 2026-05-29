const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

const DEFAULT_TIMEOUT_MS = parseInt(process.env.RESOLVER_TIMEOUT_MS || '5000', 10);
const DEFAULT_MAX_CONCURRENT = parseInt(process.env.RESOLVER_MAX_CONCURRENT || '5', 10);

class ResolverManager {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('resolver');
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.maxConcurrent = Number.isFinite(options.maxConcurrent)
      ? options.maxConcurrent
      : DEFAULT_MAX_CONCURRENT;
    this.metricsServer = options.metricsServer || null;
    this.resolvers = new Map();
    this.configPath = null;
  }

  async loadPlugins(pluginConfigPath, context = {}) {
    if (!pluginConfigPath) {
      this.logger.info('No resolver plugin config path provided');
      return;
    }

    const resolvedPath = path.isAbsolute(pluginConfigPath)
      ? pluginConfigPath
      : path.resolve(process.cwd(), pluginConfigPath);

    if (!fs.existsSync(resolvedPath)) {
      this.logger.info('Resolver plugin config file not found', { path: resolvedPath });
      return;
    }

    let config;
    try {
      config = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    } catch (error) {
      throw new Error(`Failed to parse resolver plugin config: ${error.message}`);
    }

    this.configPath = resolvedPath;
    await this.loadPluginsFromConfig(config, path.dirname(resolvedPath), context);
  }

  async loadPluginsFromConfig(pluginConfig, baseDir = process.cwd(), context = {}) {
    if (!pluginConfig || typeof pluginConfig !== 'object') {
      this.logger.warn('Resolver plugin configuration is empty or malformed');
      return;
    }

    const resolvers = pluginConfig.resolvers;
    if (!resolvers || typeof resolvers !== 'object') {
      this.logger.warn('Resolver plugin configuration missing resolvers section');
      return;
    }

    for (const [name, entry] of Object.entries(resolvers)) {
      if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) {
        this.logger.warn('Skipping resolver with missing path', { name });
        continue;
      }

      try {
        const modulePath = path.isAbsolute(entry.path)
          ? entry.path
          : path.resolve(baseDir, entry.path);

        const loaded = require(modulePath);
        const PluginImpl = loaded && loaded.default ? loaded.default : loaded;

        const instance = typeof PluginImpl === 'function'
          ? new PluginImpl()
          : PluginImpl;

        if (!instance || typeof instance.resolve !== 'function') {
          throw new Error('Resolver plugin must export an object or class with a resolve(taskId, taskConfig) method');
        }

        if (typeof instance.init === 'function') {
          await instance.init(entry.options || {}, { logger: this.logger, ...context });
        }

        this.resolvers.set(name, instance);
        this.logger.info('Loaded resolver plugin', { name, path: modulePath });
      } catch (error) {
        this.logger.error('Failed to load resolver plugin', {
          name,
          path: entry.path,
          error: error.message,
        });
      }
    }
  }

  getResolver(name) {
    return this.resolvers.get(name) || null;
  }

  async resolve(taskId, resolverName, taskConfig) {
    const resolver = this.getResolver(resolverName);
    if (!resolver) {
      this.logger.debug('No resolver plugin registered for task', { taskId, resolverName });
      return null;
    }

    const runResolver = async () => {
      const start = Date.now();
      if (this.metricsServer) {
        this.metricsServer.increment('resolverChecksTotal', 1);
      }

      let result = await Promise.resolve(resolver.resolve(taskId, taskConfig));
      const durationMs = Date.now() - start;

      if (this.metricsServer) {
        this.metricsServer.record('lastResolverDurationMs', durationMs);
      }

      if (typeof result === 'boolean') {
        result = { isReady: result };
      }

      if (result == null || typeof result !== 'object') {
        result = { isReady: Boolean(result) };
      }

      if (typeof result.isReady !== 'boolean') {
        result.isReady = Boolean(result.isReady);
      }

      return result;
    };

    const task = runResolver();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error('Resolver timed out'), { code: 'RESOLVER_TIMEOUT' })), this.timeoutMs);
    });

    try {
      return await Promise.race([task, timeoutPromise]);
    } catch (error) {
      if (error && error.code === 'RESOLVER_TIMEOUT') {
        this.logger.error('Resolver timeout', { taskId, resolverName, timeoutMs: this.timeoutMs });
        if (this.metricsServer) {
          this.metricsServer.increment('resolverTimeoutsTotal', 1);
        }
        return { isReady: false, reason: 'resolver_timeout' };
      }

      this.logger.error('Resolver execution failed', { taskId, resolverName, error: error.message });
      if (this.metricsServer) {
        this.metricsServer.increment('resolverFailuresTotal', 1);
      }
      return { isReady: false, reason: 'resolver_error' };
    }
  }

  async destroy() {
    for (const [name, resolver] of this.resolvers.entries()) {
      if (resolver && typeof resolver.destroy === 'function') {
        try {
          await resolver.destroy();
        } catch (error) {
          this.logger.debug('Resolver destroy failed', { name, error: error.message });
        }
      }
    }
    this.resolvers.clear();
  }
}

module.exports = { ResolverManager };
