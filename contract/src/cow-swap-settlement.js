'use strict';

const { createHash } = require('crypto');
const { createLogger } = require('./logger');

const DEFAULT_CONFIG = {
  maxBatchSize: 100,
  batchTimeoutMs: 5000,
  minMatchAmount: 1000000,
  slippageToleranceBps: 50,
  settlementFeeBps: 10,
};

class IntentOrder {
  constructor({
    id,
    userId,
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
    expiresAt,
    signature,
  }) {
    this.id = id;
    this.userId = userId;
    this.tokenIn = tokenIn;
    this.tokenOut = tokenOut;
    this.amountIn = amountIn;
    this.minAmountOut = minAmountOut;
    this.expiresAt = expiresAt;
    this.signature = signature;
    this.status = 'pending';
    this.createdAt = Date.now();
  }

  isValid() {
    return (
      this.amountIn > 0 &&
      this.minAmountOut > 0 &&
      this.expiresAt > Date.now() &&
      this.tokenIn !== this.tokenOut
    );
  }

  canMatchWith(other) {
    return (
      this.tokenIn === other.tokenOut &&
      this.tokenOut === other.tokenIn &&
      this.isValid() &&
      other.isValid()
    );
  }

  calculateMatchAmount(other) {
    const matchAmount = Math.min(this.amountIn, other.amountIn);
    return matchAmount;
  }
}

class CoWSettlementEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('cow-settlement');
    this.pendingIntents = new Map();
    this.settlementHistory = [];
    this.batchTimer = null;
  }

  submitIntent(intentData) {
    const intent = new IntentOrder(intentData);

    if (!intent.isValid()) {
      throw new Error('Invalid intent order');
    }

    if (this.pendingIntents.has(intent.id)) {
      throw new Error('Intent already submitted');
    }

    this.pendingIntents.set(intent.id, intent);
    this.logger.info('Intent submitted', {
      id: intent.id,
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amountIn: intent.amountIn,
    });

    return { accepted: true, intentId: intent.id };
  }

  matchIntents() {
    const intents = Array.from(this.pendingIntents.values()).filter((i) => i.isValid());
    const matches = [];
    const matched = new Set();

    for (let i = 0; i < intents.length; i++) {
      if (matched.has(intents[i].id)) continue;

      for (let j = i + 1; j < intents.length; j++) {
        if (matched.has(intents[j].id)) continue;

        if (intents[i].canMatchWith(intents[j])) {
          const matchAmount = intents[i].calculateMatchAmount(intents[j]);

          if (matchAmount >= this.config.minMatchAmount) {
            const clearingPrice = this.calculateClearingPrice(
              intents[i],
              intents[j],
              matchAmount
            );

            const match = {
              id: `match_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              intent1: intents[i],
              intent2: intents[j],
              matchAmount,
              clearingPrice,
              timestamp: Date.now(),
            };

            matches.push(match);
            matched.add(intents[i].id);
            matched.add(intents[j].id);

            intents[i].status = 'matched';
            intents[j].status = 'matched';

            break;
          }
        }
      }
    }

    return matches;
  }

  calculateClearingPrice(intent1, intent2, matchAmount) {
    const price1 = intent1.amountIn / intent1.minAmountOut;
    const price2 = intent2.amountIn / intent2.minAmountOut;

    const avgPrice = (price1 + price2) / 2;
    const clearingAmount = Math.floor(matchAmount / avgPrice);

    const slippage1 = Math.abs(clearingAmount - intent1.minAmountOut) / intent1.minAmountOut;
    const slippage2 = Math.abs(clearingAmount - intent2.minAmountOut) / intent2.minAmountOut;

    if (
      slippage1 > this.config.slippageToleranceBps / 10000 ||
      slippage2 > this.config.slippageToleranceBps / 10000
    ) {
      return null;
    }

    return clearingAmount;
  }

  async executeSettlement(match) {
    const settlementFee = Math.floor(
      (match.matchAmount * this.config.settlementFeeBps) / 10000
    );

    const settlement = {
      id: match.id,
      intent1Id: match.intent1.id,
      intent2Id: match.intent2.id,
      matchAmount: match.matchAmount,
      clearingPrice: match.clearingPrice,
      settlementFee,
      executedAt: Date.now(),
      status: 'completed',
    };

    this.settlementHistory.push(settlement);
    this.pendingIntents.delete(match.intent1.id);
    this.pendingIntents.delete(match.intent2.id);

    this.logger.info('Settlement executed', {
      id: settlement.id,
      matchAmount: settlement.matchAmount,
      clearingPrice: settlement.clearingPrice,
      fee: settlement.settlementFee,
    });

    return settlement;
  }

  calculateResidualAmount(intent, matchedAmount) {
    return Math.max(0, intent.amountIn - matchedAmount);
  }

  generateSettlementProof(settlement) {
    const proofData = {
      settlementId: settlement.id,
      intent1Hash: createHash('sha256')
        .update(settlement.intent1Id)
        .digest('hex'),
      intent2Hash: createHash('sha256')
        .update(settlement.intent2Id)
        .digest('hex'),
      matchAmount: settlement.matchAmount,
      clearingPrice: settlement.clearingPrice,
      timestamp: settlement.executedAt,
    };

    return createHash('sha256')
      .update(JSON.stringify(proofData))
      .digest('hex');
  }

  getSettlementStats() {
    const totalSettlements = this.settlementHistory.length;
    const totalVolume = this.settlementHistory.reduce(
      (sum, s) => sum + s.matchAmount,
      0
    );
    const totalFees = this.settlementHistory.reduce(
      (sum, s) => sum + s.settlementFee,
      0
    );

    return {
      totalSettlements,
      totalVolume,
      totalFees,
      pendingIntents: this.pendingIntents.size,
      avgSettlementSize: totalSettlements > 0 ? totalVolume / totalSettlements : 0,
    };
  }

  cleanupExpiredIntents() {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, intent] of this.pendingIntents) {
      if (intent.expiresAt < now) {
        intent.status = 'expired';
        this.pendingIntents.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info('Cleaned up expired intents', { count: cleaned });
    }

    return cleaned;
  }
}

module.exports = {
  CoWSettlementEngine,
  IntentOrder,
  DEFAULT_CONFIG,
};
