const parser = require('./parser');
const registry = require('./registry');
const errorHandler = require('./errorHandler');
const Monitor = require('./monitor');

class ABIRegistryService {
  constructor() {
    this.monitor = new Monitor(parser, registry);
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
}

module.exports = new ABIRegistryService();
