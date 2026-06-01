const errorHandler = require('./errorHandler');

class Registry {
  constructor() {
    // Map of contractAddress -> ABI object
    this.abis = new Map();
  }

  addABI(contractAddress, abi) {
    if (!contractAddress || !abi) {
      errorHandler.logError('Registry', 'Invalid contractAddress or ABI provided');
      return false;
    }
    try {
      this.abis.set(contractAddress, abi);
      console.log(`[Registry] Added ABI for ${contractAddress}`);
      return true;
    } catch (err) {
      errorHandler.logError('Registry', err);
      return false;
    }
  }

  getABI(contractAddress) {
    return this.abis.get(contractAddress) || null;
  }

  searchByFunctionName(funcName) {
    const results = [];
    for (const [address, abi] of this.abis.entries()) {
      const hasFunction = abi.functions && abi.functions.some(f => f.name === funcName);
      if (hasFunction) {
        results.push(address);
      }
    }
    return results;
  }

  getAll() {
    return Object.fromEntries(this.abis);
  }

  clear() {
    this.abis.clear();
  }
}

module.exports = new Registry();
