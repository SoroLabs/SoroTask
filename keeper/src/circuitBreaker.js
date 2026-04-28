const { createLogger } = require('./logger');

const State = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.state = State.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    
    // Configuration
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs || 30000; // 30 seconds
    this.halfOpenMaxRequests = options.halfOpenMaxRequests || 1;
    
    this.lastFailureTime = null;
    this.logger = options.logger || createLogger(`circuit-breaker:${name}`);
    this.metrics = options.metrics || null;
  }

  async execute(fn) {
    if (this.state === State.OPEN) {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeoutMs) {
        this.transitionTo(State.HALF_OPEN);
      } else {
        this.logger.warn('Circuit is OPEN, rejecting request', { name: this.name });
        if (this.metrics) {
          this.metrics.increment('circuitBreakerRejections');
        }
        throw new Error(`Circuit breaker "${this.name}" is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === State.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxRequests) {
        this.transitionTo(State.CLOSED);
      }
    }
  }

  onFailure(error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    this.logger.error('Circuit breaker captured failure', { 
      name: this.name, 
      state: this.state, 
      failureCount: this.failureCount,
      error: error.message || String(error)
    });

    if (this.state === State.CLOSED) {
      if (this.failureCount >= this.failureThreshold) {
        this.transitionTo(State.OPEN);
      }
    } else if (this.state === State.HALF_OPEN) {
      this.transitionTo(State.OPEN);
    }
  }

  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.failureCount = 0;
    this.successCount = 0;

    this.logger.info('Circuit breaker state transition', { 
      name: this.name, 
      oldState, 
      newState 
    });

    if (this.metrics) {
      this.metrics.increment('circuitBreakerTransitions');
      this.metrics.record(`circuitBreakerState:${this.name}`, newState === State.OPEN ? 2 : (newState === State.HALF_OPEN ? 1 : 0));
    }
  }

  getState() {
    return this.state;
  }
}

module.exports = { CircuitBreaker, State };
