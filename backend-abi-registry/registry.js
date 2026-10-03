const errorHandler = require('./errorHandler');

// Soroban contract addresses are Stellar strkeys with version byte 2 (C prefix).
// A valid contract strkey is exactly 56 characters: C + 55 base-32 chars.
// We also accept G-prefixed account keys (version byte 6) for completeness.
const SOROBAN_CONTRACT_STRKEY_RE = /^C[A-Z2-7]{55}$/;
const STELLAR_ACCOUNT_STRKEY_RE = /^G[A-Z2-7]{55}$/;

/**
 * Returns true if `address` looks like a valid Soroban contract strkey (C...) or
 * Stellar account strkey (G...). Both are 56-character base-32 encoded strings.
 *
 * @param {string} address
 * @returns {boolean}
 */
function isValidContractAddress(address) {
  if (typeof address !== 'string') return false;
  return SOROBAN_CONTRACT_STRKEY_RE.test(address) || STELLAR_ACCOUNT_STRKEY_RE.test(address);
}

class Registry {
  constructor() {
    // Map of contractAddress -> ABI object
    this.abis = new Map();
  }

  /**
   * Stores an ABI for the given Soroban contract address.
   *
   * @param {string} contractAddress - Must be a valid Soroban C-strkey (56 chars, C prefix).
   * @param {Object} abi - Parsed ABI object.
   * @returns {boolean} true on success, false on validation or storage failure.
   */
  addABI(contractAddress, abi) {
    if (!contractAddress || !abi) {
      errorHandler.logError('Registry', 'Invalid contractAddress or ABI provided');
      return false;
    }
    if (!isValidContractAddress(contractAddress)) {
      errorHandler.logError(
        'Registry',
        `Invalid Soroban contract address: "${contractAddress}". ` +
          'Must be a 56-character C-strkey (C prefix, base-32 alphabet A-Z2-7).'
      );
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
module.exports.isValidContractAddress = isValidContractAddress;
