'use strict';

const { createHash } = require('crypto');
const { createLogger } = require('./logger');
const { BatchSolver, DEFAULT_SOLVER_CONFIG } = require('./batchSolver');

const DEFAULT_CONFIG = {
  maxBatchSize: 100,
  batchTimeoutMs: 5000,
  minMatchAmount: 1000,
  slippageToleranceBps: 50,
  standardDexFeeBps: 30,
  cowFeeDiscountPercent: 40, // 40% discount for CoW batch settlement
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
    this.amountIn = Number(amountIn);
    this.minAmountOut = Number(minAmountOut);
    this.expiresAt = expiresAt || Date.now() + 300000;
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
    return Math.min(this.amountIn, other.amountIn);
  }
}

class CoWSettlementEngine {
  constructor(config = {}, dexRouter = null) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('cow-settlement');
    this.pendingIntents = new Map();
    this.settlementHistory = [];
    this.batchTimer = null;
    this.dexRouter = dexRouter;
    this.solver = new BatchSolver({
      standardDexFeeBps: this.config.standardDexFeeBps,
      cowFeeDiscountPercent: this.config.cowFeeDiscountPercent,
    });
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

  /**
   * Run batch settlement solver across all pending intents
   */
  matchIntents() {
    const intents = Array.from(this.pendingIntents.values()).filter((i) => i.isValid());
    const solution = this.solver.solve(intents, this.dexRouter);

    const matches = [];

    for (const solvedPair of solution.solvedPairs) {
      if (solvedPair.matches && solvedPair.matches.length > 0) {
        // Group matches into complementary atomic settlements
        const matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const pairMatch = {
          id: matchId,
          pair: solvedPair.pair,
          uniformClearingPrice: solvedPair.uniformClearingPrice,
          matchedVolume: solvedPair.internalMatchedVolume,
          standardFee: solvedPair.standardFee,
          cowFee: solvedPair.cowFee,
          feeSavings: solvedPair.feeSavings, // 40% discount
          matches: solvedPair.matches,
          residualImbalance: solvedPair.residualImbalance,
          timestamp: Date.now(),
        };

        matches.push(pairMatch);

        // Mark participating intents as matched
        for (const m of solvedPair.matches) {
          const intent = this.pendingIntents.get(m.orderId);
          if (intent) {
            intent.status = 'matched';
          }
        }
      }
    }

    return matches;
  }

  /**
   * Execute atomic batch settlement
   */
  async executeSettlement(match) {
    const settlement = {
      id: match.id,
      pair: match.pair,
      matchAmount: match.matchedVolume,
      clearingPrice: match.uniformClearingPrice,
      settlementFee: match.cowFee,
      feeSavings: match.feeSavings,
      residualImbalance: match.residualImbalance,
      executedAt: Date.now(),
      status: 'completed',
    };

    this.settlementHistory.push(settlement);

    // Clean up matched intents from pending map
    if (match.matches) {
      for (const m of match.matches) {
        this.pendingIntents.delete(m.orderId);
      }
    }

    this.logger.info('Settlement executed with 40% fee reduction & uniform price', {
      id: settlement.id,
      matchAmount: settlement.matchAmount,
      clearingPrice: settlement.clearingPrice,
      fee: settlement.settlementFee,
      savings: settlement.feeSavings,
    });

    return settlement;
  }

  calculateResidualAmount(intent, matchedAmount) {
    return Math.max(0, intent.amountIn - matchedAmount);
  }

  generateSettlementProof(settlement) {
    const proofData = {
      settlementId: settlement.id,
      pair: settlement.pair,
      matchAmount: settlement.matchAmount,
      clearingPrice: settlement.clearingPrice,
      feeSavings: settlement.feeSavings,
      timestamp: settlement.executedAt,
    };

    return createHash('sha256')
      .update(JSON.stringify(proofData))
      .digest('hex');
  }

  getSettlementStats() {
    const totalSettlements = this.settlementHistory.length;
    const totalVolume = this.settlementHistory.reduce(
      (sum, s) => sum + (s.matchAmount || 0),
      0
    );
    const totalFees = this.settlementHistory.reduce(
      (sum, s) => sum + (s.settlementFee || 0),
      0
    );
    const totalSavings = this.settlementHistory.reduce(
      (sum, s) => sum + (s.feeSavings || 0),
      0
    );

    return {
      totalSettlements,
      totalVolume,
      totalFees,
      totalSavings,
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
