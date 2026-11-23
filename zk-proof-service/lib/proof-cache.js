'use strict';

const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_MAX_MEMORY_ENTRIES = Number(process.env.ZK_PROOF_CACHE_MAX_ENTRIES) || 10000;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function createProofCacheKey(circuitId, publicInputs, witness, circuitArtifactHash = '') {
  const publicInputsHash = sha256Json(publicInputs);
  const witnessHash = sha256Json(witness);
  const circuitKey = `${circuitId}:${circuitArtifactHash}`;
  return `zk:proof:${crypto.createHash('sha256').update(`${circuitKey}:${publicInputsHash}:${witnessHash}`).digest('hex')}`;
}

class ProofCache {
  constructor(options = {}) {
    this.ttlSeconds = options.ttlSeconds ?? (Number(process.env.ZK_PROOF_CACHE_TTL_SECONDS) || DEFAULT_TTL_SECONDS);
    this.maxMemoryEntries = options.maxMemoryEntries ?? DEFAULT_MAX_MEMORY_ENTRIES;
    this.redis = options.redis ?? null;
    this.memory = new Map();
    if (!this.redis && options.redisUrl) {
      const Redis = require('ioredis');
      this.redis = new Redis(options.redisUrl);
      this.ownsRedis = true;
    }
  }

  _evictIfNeeded() {
    // Drop expired entries first, then oldest (Map preserves insertion order).
    if (this.memory.size < this.maxMemoryEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt <= now) this.memory.delete(key);
    }
    while (this.memory.size >= this.maxMemoryEntries) {
      const oldestKey = this.memory.keys().next().value;
      this.memory.delete(oldestKey);
    }
  }

  async get(key) {
    if (this.redis) {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    }
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.proof;
  }

  async set(key, proof) {
    if (this.redis) {
      await this.redis.set(key, JSON.stringify(proof), 'EX', this.ttlSeconds);
      return;
    }
    if (this.memory.has(key)) this.memory.delete(key);
    this._evictIfNeeded();
    this.memory.set(key, { proof, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }

  async close() {
    if (this.ownsRedis) await this.redis.quit();
  }
}

module.exports = { ProofCache, createProofCacheKey, canonicalize, sha256Json, DEFAULT_TTL_SECONDS };
