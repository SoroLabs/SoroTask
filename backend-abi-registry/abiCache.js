const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_TTL_SECONDS = 3600;

class AbiCache {
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
    this.ttlSeconds = options.ttlSeconds || DEFAULT_TTL_SECONDS;
    this.redis = options.redisClient || null;
    this.memory = new Map();
  }

  static key(contractId, wasmHash) {
    if (!contractId || !wasmHash) throw new Error('contractId and wasmHash are required');
    return `abi:${String(contractId)}:${String(wasmHash)}`;
  }

  get(contractId, wasmHash) {
    const key = AbiCache.key(contractId, wasmHash);
    const entry = this.memory.get(key);
    if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) {
      this.memory.delete(key);
      return null;
    }
    this.memory.delete(key);
    this.memory.set(key, entry);
    return entry.value;
  }

  async getPersistent(contractId, wasmHash) {
    const key = AbiCache.key(contractId, wasmHash);
    const memoryValue = this.get(contractId, wasmHash);
    if (memoryValue) return memoryValue;
    if (!this.redis || typeof this.redis.get !== 'function') return null;

    const serialized = await this.redis.get(key);
    if (!serialized) return null;
    const value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    this.setMemory(key, value);
    return value;
  }

  async set(contractId, wasmHash, value) {
    const key = AbiCache.key(contractId, wasmHash);
    this.setMemory(key, value);
    if (this.redis && typeof this.redis.set === 'function') {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.ttlSeconds);
    }
    return value;
  }

  setMemory(key, value) {
    this.memory.delete(key);
    this.memory.set(key, {
      value,
      expiresAt: this.ttlSeconds ? Date.now() + this.ttlSeconds * 1000 : null,
    });
    while (this.memory.size > this.maxEntries) {
      this.memory.delete(this.memory.keys().next().value);
    }
  }

  async invalidate(contractId, wasmHash) {
    const key = AbiCache.key(contractId, wasmHash);
    this.memory.delete(key);
    if (this.redis && typeof this.redis.del === 'function') await this.redis.del(key);
  }

  async invalidateContract(contractId, wasmHash = null) {
    if (wasmHash) return this.invalidate(contractId, wasmHash);

    const prefix = `abi:${String(contractId)}:`;
    for (const key of this.memory.keys()) {
      if (key.startsWith(prefix)) this.memory.delete(key);
    }
    if (this.redis && typeof this.redis.keys === 'function' && typeof this.redis.del === 'function') {
      const keys = await this.redis.keys(`${prefix}*`);
      if (keys.length) await this.redis.del(...keys);
    }
  }

  async handleIndexerEvent(event) {
    if (!event || event.event_name !== 'ContractUpgraded') return false;
    const payload = event.data || event.payload || {};
    const contractId = event.contract_id || event.contractId || payload.contract_id || payload.contractId;
    const oldHash = payload.old_hash || payload.oldHash || event.old_hash || event.oldHash;
    if (contractId) await this.invalidateContract(contractId, oldHash);
    if (contractId && this.redis && typeof this.redis.publish === 'function') {
      await this.redis.publish('abi:invalidate', JSON.stringify({ contractId, oldHash }));
    }
    return Boolean(contractId);
  }

  clear() {
    this.memory.clear();
  }
}

module.exports = { AbiCache, DEFAULT_MAX_ENTRIES };