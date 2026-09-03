const parser = require('./parser');
const registry = require('./registry');
const errorHandler = require('./errorHandler');
const errorCodes = require('./errorCodes');
const Monitor = require('./monitor');
const { AbiCache } = require('./abiCache');

class ABIRegistryService {
  constructor(options = {}) {
    this.monitor = new Monitor(parser, registry);
    this.cache = options.cache || new AbiCache(options);
    this.indexerEvents = null;
    if (options.indexerEvents) this.attachIndexerEvents(options.indexerEvents);
  }

  start() {
    console.log('[ABIRegistryService] Initializing ABI Registry and Parser Service...');
    this.monitor.start();
  }

  stop() {
    console.log('[ABIRegistryService] Shutting down ABI Registry and Parser Service...');
    this.monitor.stop();
  }

  getRegistry() {
    return registry;
  }
  
  getErrorHandler() {
    return errorHandler;
  }

  getErrorCodes() {
    return errorCodes;
  }

  decodeErrorCode(code) {
    return errorCodes.decodeErrorCode(code);
  }

  async getABI(contractId, wasmHash, fetchABI) {
    const cached = await this.cache.getPersistent(contractId, wasmHash);
    if (cached) return cached;
    if (typeof fetchABI !== 'function') return null;
    const abi = await fetchABI();
    if (abi) await this.cache.set(contractId, wasmHash, abi);
    return abi;
  }

  async invalidateOnIndexerEvent(event) {
    return this.cache.handleIndexerEvent(event);
  }

  attachIndexerEvents(eventEmitter) {
    if (!eventEmitter || typeof eventEmitter.on !== 'function') return false;
    this.indexerEvents = eventEmitter;
    eventEmitter.on('event', event => this.invalidateOnIndexerEvent(event));
    eventEmitter.on('ContractUpgraded', event => this.invalidateOnIndexerEvent(event));
    return true;
  }
}

module.exports = new ABIRegistryService();
