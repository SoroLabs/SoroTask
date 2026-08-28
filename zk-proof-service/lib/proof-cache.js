'use strict';

const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

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
    this.redis = options.redis ?? null;
    this.memory = new Map();
    if (!this.redis && options.redisUrl) {
      const Redis = require('ioredis');
      this.redis = new Redis(options.redisUrl);
      this.ownsRedis = true;
    }
  }

  async get(key) {
    const value = this.redis ? await this.redis.get(key) : this.memory.get(key);
    if (!value) return null;
    if (this.redis) return JSON.parse(value);
    if (value.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return value.proof;
  }

  async set(key, proof) {
    if (this.redis) {
      await this.redis.set(key, JSON.stringify(proof), 'EX', this.ttlSeconds);
      return;
    }
    this.memory.set(key, { proof, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }

  async close() {
    if (this.ownsRedis) await this.redis.quit();
  }
}

module.exports = { ProofCache, createProofCacheKey, canonicalize, sha256Json, DEFAULT_TTL_SECONDS };
