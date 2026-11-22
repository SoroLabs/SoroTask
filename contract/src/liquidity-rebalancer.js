'use strict';

const { createLogger } = require('./logger');

const DEFAULT_CONFIG = {
  tickSpacing: 1,
  slippageToleranceBps: 50,
  rebalanceThresholdBps: 200,
  feeCompoundEnabled: true,
  maxGasPerRebalance: 500000,
  priceOracleUrl: process.env.DEX_PRICE_ORACLE_URL || null,
};

class TickCalculator {
  static priceToTick(price, base = 1.0001) {
    return Math.floor(Math.log(price) / Math.log(base));
  }

  static tickToPrice(tick, base = 1.0001) {
    return Math.pow(base, tick);
  }

  static calculateOptimalRange(currentPrice, volatility, targetRangeWidth) {
    const currentTick = this.priceToTick(currentPrice);
    const halfRange = Math.floor(targetRangeWidth / 2);

    return {
      tickLower: currentTick - halfRange,
      tickUpper: currentTick + halfRange,
      currentTick,
      priceLower: this.tickToPrice(currentTick - halfRange),
      priceUpper: this.tickToPrice(currentTick + halfRange),
    };
  }

  static isOutOfRange(positionTickLower, positionTickUpper, currentTick) {
    return currentTick < positionTickLower || currentTick > positionTickUpper;
  }

  static calculateImpermanentLoss(priceRatio) {
    const sqrtRatio = Math.sqrt(priceRatio);
    return 2 * sqrtRatio / (1 + priceRatio) - 1;
  }
}

class FeeCollector {
  constructor(poolContract) {
    this.poolContract = poolContract;
    this.uncollectedFees = new Map();
  }

  async collectFees(positionId) {
    const fees = this.uncollectedFees.get(positionId) || { token0: 0, token1: 0 };
    this.uncollectedFees.delete(positionId);
    return fees;
  }

  addFees(positionId, token0Amount, token1Amount) {
    const existing = this.uncollectedFees.get(positionId) || { token0: 0, token1: 0 };
    this.uncollectedFees.set(positionId, {
      token0: existing.token0 + token0Amount,
      token1: existing.token1 + token1Amount,
    });
  }

  getAccumulatedFees(positionId) {
    return this.uncollectedFees.get(positionId) || { token0: 0, token1: 0 };
  }
}

class LiquidityRebalancer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('liquidity-rebalancer');
    this.feeCollector = new FeeCollector();
    this.positions = new Map();
    this.rebalanceHistory = [];
  }

  async monitorPosition(position) {
    const { id, tickLower, tickUpper, liquidity, token0, token1 } = position;
    this.positions.set(id, {
      ...position,
      lastChecked: Date.now(),
      outOfRangeCount: 0,
    });

    return position;
  }

  async checkAndRebalance(positionId, currentPrice) {
    const position = this.positions.get(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    const currentTick = TickCalculator.priceToTick(currentPrice);
    const isOutOfRange = TickCalculator.isOutOfRange(
      position.tickLower,
      position.tickUpper,
      currentTick
    );

    if (!isOutOfRange) {
      this.logger.debug('Position in range', { positionId, currentTick });
      return { rebalanced: false, reason: 'in_range' };
    }

    this.logger.warn('Position out of range', {
      positionId,
      currentTick,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
    });

    return this.executeRebalance(position, currentPrice);
  }

  async executeRebalance(position, currentPrice) {
    const rebalanceStart = Date.now();

    try {
      const fees = await this.feeCollector.collectFees(position.id);

      const newRange = TickCalculator.calculateOptimalRange(
        currentPrice,
        0.05,
        position.tickUpper - position.tickLower
      );

      const slippageCheck = this.checkSlippage(
        currentPrice,
        newRange.priceLower,
        newRange.priceUpper
      );

      if (!slippageCheck.acceptable) {
        this.logger.warn('Slippage too high', {
          positionId: position.id,
          slippage: slippageCheck.slippageBps,
        });
        return { rebalanced: false, reason: 'slippage_too_high' };
      }

      const newPosition = {
        ...position,
        tickLower: newRange.tickLower,
        tickUpper: newRange.tickUpper,
        lastRebalanced: Date.now(),
        feesCollected: fees,
      };

      this.positions.set(position.id, newPosition);

      const rebalanceRecord = {
        positionId: position.id,
        timestamp: Date.now(),
        oldRange: { tickLower: position.tickLower, tickUpper: position.tickUpper },
        newRange: { tickLower: newRange.tickLower, tickUpper: newRange.tickUpper },
        feesCollected: fees,
        durationMs: Date.now() - rebalanceStart,
      };

      this.rebalanceHistory.push(rebalanceRecord);

      this.logger.info('Position rebalanced', {
        positionId: position.id,
        newTickLower: newRange.tickLower,
        newTickUpper: newRange.tickUpper,
        fees,
      });

      return { rebalanced: true, newPosition, fees };
    } catch (error) {
      this.logger.error('Rebalance failed', {
        positionId: position.id,
        error: error.message,
      });
      throw error;
    }
  }

  checkSlippage(currentPrice, targetPriceLower, targetPriceUpper) {
    const slippageLower = Math.abs(currentPrice - targetPriceLower) / currentPrice * 10000;
    const slippageUpper = Math.abs(currentPrice - targetPriceUpper) / currentPrice * 10000;
    const maxSlippage = Math.max(slippageLower, slippageUpper);

    return {
      acceptable: maxSlippage <= this.config.slippageToleranceBps,
      slippageBps: maxSlippage,
    };
  }

  calculateOptimalTickSpread(volatility) {
    const baseSpread = 1000;
    const volatilityFactor = 1 + volatility * 2;
    return Math.floor(baseSpread * volatilityFactor);
  }

  getStats() {
    return {
      activePositions: this.positions.size,
      totalRebalances: this.rebalanceHistory.length,
      lastRebalance: this.rebalanceHistory[this.rebalanceHistory.length - 1] || null,
    };
  }
}

module.exports = {
  LiquidityRebalancer,
  TickCalculator,
  FeeCollector,
  DEFAULT_CONFIG,
};
