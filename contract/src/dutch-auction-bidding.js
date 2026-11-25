'use strict';

const { createLogger } = require('./logger');

const DEFAULT_CONFIG = {
  minBountyBps: 50,
  maxBountyBps: 500,
  decayIntervalMs: 60000,
  decayRatePerIntervalBps: 25,
  auctionDurationMs: 3600000,
  minBidIncrementBps: 10,
  priorityQueueMaxSize: 1000,
};

class DutchAuctionMechanism {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('dutch-auction-bidding');
    this.activeAuctions = new Map();
    this.bidHistory = [];
  }

  createAuction(taskId, creatorAddress, gasEscrow, deadline) {
    const auction = {
      taskId,
      creatorAddress,
      gasEscrow,
      deadline,
      currentBountyBps: this.config.minBountyBps,
      startTime: Date.now(),
      bids: [],
      status: 'active',
      highestBid: null,
    };

    this.activeAuctions.set(taskId, auction);
    this.logger.info('Auction created', {
      taskId,
      creatorAddress,
      gasEscrow,
      deadline,
    });

    return auction;
  }

  calculateCurrentBounty(auction) {
    const elapsed = Date.now() - auction.startTime;
    const intervals = Math.floor(elapsed / this.config.decayIntervalMs);
    const currentBounty = Math.min(
      this.config.minBountyBps + intervals * this.config.decayRatePerIntervalBps,
      this.config.maxBountyBps
    );

    return currentBounty;
  }

  placeBid(taskId, keeperAddress, bidAmountBps) {
    const auction = this.activeAuctions.get(taskId);
    if (!auction) {
      throw new Error(`Auction ${taskId} not found`);
    }

    if (auction.status !== 'active') {
      throw new Error(`Auction ${taskId} is not active`);
    }

    if (Date.now() > auction.deadline) {
      auction.status = 'expired';
      throw new Error(`Auction ${taskId} has expired`);
    }

    const currentBounty = this.calculateCurrentBounty(auction);

    if (bidAmountBps < currentBounty) {
      throw new Error(`Bid ${bidAmountBps} bps is below current bounty ${currentBounty} bps`);
    }

    if (auction.highestBid && bidAmountBps <= auction.highestBid.amountBps) {
      throw new Error(`Bid must be higher than current highest bid ${auction.highestBid.amountBps} bps`);
    }

    const bid = {
      taskId,
      keeperAddress,
      amountBps: bidAmountBps,
      timestamp: Date.now(),
      priority: this.calculatePriority(bidAmountBps, auction),
    };

    auction.bids.push(bid);
    auction.highestBid = bid;

    this.bidHistory.push(bid);

    this.logger.info('Bid placed', {
      taskId,
      keeperAddress,
      amountBps: bidAmountBps,
      priority: bid.priority,
    });

    return bid;
  }

  calculatePriority(bidAmountBps, auction) {
    const timeRemaining = Math.max(0, auction.deadline - Date.now());
    const timeFactor = timeRemaining / (auction.deadline - auction.startTime);
    const bidFactor = bidAmountBps / this.config.maxBountyBps;

    return Math.floor((bidFactor * 0.7 + timeFactor * 0.3) * 1000000);
  }

  selectWinner(taskId) {
    const auction = this.activeAuctions.get(taskId);
    if (!auction || auction.bids.length === 0) {
      return null;
    }

    const sortedBids = [...auction.bids].sort((a, b) => b.priority - a.priority);
    const winner = sortedBids[0];

    const payoutAmount = this.calculatePayout(auction, winner.amountBps);

    auction.status = 'completed';
    auction.winner = winner;
    auction.payoutAmount = payoutAmount;

    this.logger.info('Winner selected', {
      taskId,
      winner: winner.keeperAddress,
      payoutAmount,
      totalBids: auction.bids.length,
    });

    return {
      winner: winner.keeperAddress,
      payoutAmount,
      bidAmountBps: winner.amountBps,
      priority: winner.priority,
    };
  }

  calculatePayout(auction, bidAmountBps) {
    const basePayout = (auction.gasEscrow * bidAmountBps) / 10000;
    return Math.min(basePayout, auction.gasEscrow);
  }

  getAuctionStatus(taskId) {
    const auction = this.activeAuctions.get(taskId);
    if (!auction) {
      return null;
    }

    return {
      ...auction,
      currentBounty: this.calculateCurrentBounty(auction),
      timeRemaining: Math.max(0, auction.deadline - Date.now()),
    };
  }

  cleanupExpiredAuctions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, auction] of this.activeAuctions) {
      if (auction.status === 'active' && now > auction.deadline) {
        auction.status = 'expired';
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info('Cleaned up expired auctions', { count: cleaned });
    }

    return cleaned;
  }

  getStats() {
    const active = Array.from(this.activeAuctions.values()).filter(
      (a) => a.status === 'active'
    ).length;

    return {
      activeAuctions: active,
      totalAuctions: this.activeAuctions.size,
      totalBids: this.bidHistory.length,
    };
  }
}

class PriorityBiddingPool {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('priority-bidding-pool');
    this.pendingBids = [];
    this.processedBids = [];
  }

  submitBid(bid) {
    if (this.pendingBids.length >= this.config.priorityQueueMaxSize) {
      this.pendingBids.sort((a, b) => b.priority - a.priority);
      this.pendingBids.pop();
    }

    this.pendingBids.push(bid);
    this.pendingBids.sort((a, b) => b.priority - a.priority);

    this.logger.debug('Bid submitted to pool', {
      taskId: bid.taskId,
      keeper: bid.keeperAddress,
      priority: bid.priority,
    });
  }

  extractTopBids(count) {
    const extracted = this.pendingBids.splice(0, count);
    this.processedBids.push(...extracted);
    return extracted;
  }

  getPoolState() {
    return {
      pendingCount: this.pendingBids.length,
      processedCount: this.processedBids.length,
      topBids: this.pendingBids.slice(0, 10).map((b) => ({
        taskId: b.taskId,
        keeper: b.keeperAddress,
        priority: b.priority,
      })),
    };
  }
}

module.exports = {
  DutchAuctionMechanism,
  PriorityBiddingPool,
  DEFAULT_CONFIG,
};
