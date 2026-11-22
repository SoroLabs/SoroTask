'use strict';

const DEFAULT_MIN_RESERVE = 1000;

/**
 * Computes and executes a reserve top-up through an injected SEP-24 client.
 * The idempotency key makes retries safe when the anchor or RPC is slow.
 */
class ReserveRebalancer {
  constructor({ anchor, reserveReader, minReserve = DEFAULT_MIN_RESERVE, clock = Date }) {
    if (!anchor || typeof anchor.deposit !== 'function') throw new TypeError('anchor.deposit is required');
    this.anchor = anchor;
    this.reserveReader = reserveReader;
    this.minReserve = minReserve;
    this.clock = clock;
    this.completed = new Set();
  }

  async rebalance({ account, amount, asset = 'XLM', dryRun = false }) {
    if (!account || !Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('account and positive amount are required');
    const current = this.reserveReader ? await this.reserveReader(account) : 0;
    const required = Math.max(0, this.minReserve - current);
    const topUp = Math.min(amount, required);
    const idempotencyKey = `reserve:${account}:${asset}:${this.clock.now()}`;
    if (topUp === 0 || dryRun) return { account, asset, current, required, topUp, dryRun: true, idempotencyKey };
    if (this.completed.has(idempotencyKey)) return { account, asset, topUp, idempotencyKey, duplicate: true };
    const result = await this.anchor.deposit({ account, asset, amount: topUp, idempotencyKey });
    this.completed.add(idempotencyKey);
    return { account, asset, topUp, idempotencyKey, result };
  }
}

module.exports = { ReserveRebalancer, DEFAULT_MIN_RESERVE };
