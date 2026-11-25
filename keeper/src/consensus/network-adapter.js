/**
 * Consensus Network Adapter
 * Integrates consensus messaging with existing P2P network
 * Routes consensus messages through P2P infrastructure
 */

const { createLogger } = require('../logger');

const logger = createLogger('consensus-network');

class ConsensusNetworkAdapter {
  constructor(options = {}) {
    this.p2pNetwork = options.p2pNetwork; // Required: P2P network instance
    this.consensusEngine = options.consensusEngine; // Required: Consensus engine
    this.keeperId = options.keeperId;
    this.logger = options.logger || logger;
    
    // Message handlers for different types
    this.handlers = new Map();
    
    // In-flight message tracking
    this.sentMessages = new Map();
    this.messageTimeout = options.messageTimeout || 30000;

    if (this.p2pNetwork) {
      this._setupP2PListeners();
    }
  }

  /**
   * Setup P2P message listeners
   * @private
   */
  _setupP2PListeners() {
    // Listen for consensus messages from peers
    this.p2pNetwork.on('message', async (msg) => {
      if (msg.type === 'consensus') {
        await this._handleP2PConsensusMessage(msg);
      }
    });

    this.p2pNetwork.on('peer:joined', (peerId) => {
      this.logger.debug('Peer joined network', { peerId });
    });

    this.p2pNetwork.on('peer:left', (peerId) => {
      this.logger.debug('Peer left network', { peerId });
    });
  }

  /**
   * Broadcast consensus message through P2P network
   * @param {Object} message - Consensus message to broadcast
   * @returns {Promise<void>}
   */
  async broadcast(message) {
    if (!this.p2pNetwork) {
      this.logger.warn('P2P network not configured, skipping broadcast');
      return;
    }

    try {
      const envelope = {
        type: 'consensus',
        payload: message,
        timestamp: Date.now(),
      };

      await this.p2pNetwork.broadcast(envelope);
      
      this.logger.debug('Consensus message broadcast', {
        messageType: message.type,
        taskId: message.taskId,
        epoch: message.epoch,
      });

      // Track sent message
      const trackingKey = `${message.id}:${message.taskId}:${message.epoch}`;
      this.sentMessages.set(trackingKey, {
        message,
        sentAt: Date.now(),
      });
    } catch (err) {
      this.logger.error('Failed to broadcast consensus message', {
        error: err.message,
        messageType: message.type,
      });
      throw err;
    }
  }

  /**
   * Send consensus message to specific peer
   * @param {string} peerId - Peer ID to send to
   * @param {Object} message - Consensus message
   * @returns {Promise<void>}
   */
  async sendToPeer(peerId, message) {
    if (!this.p2pNetwork) {
      this.logger.warn('P2P network not configured, cannot send to peer');
      return;
    }

    try {
      const envelope = {
        type: 'consensus',
        payload: message,
        timestamp: Date.now(),
      };

      await this.p2pNetwork.sendToPeer(peerId, envelope);
      
      this.logger.debug('Consensus message sent to peer', {
        peerId,
        messageType: message.type,
        taskId: message.taskId,
      });
    } catch (err) {
      this.logger.error('Failed to send to peer', {
        peerId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Handle incoming consensus message from P2P
   * @private
   */
  async _handleP2PConsensusMessage(envelope) {
    try {
      const message = envelope.payload;
      
      if (!message || typeof message !== 'object') {
        this.logger.warn('Invalid consensus message received');
        return;
      }

      // Forward to consensus engine for processing
      if (this.consensusEngine) {
        const result = await this.consensusEngine.handleMessage(message);
        
        if (result.handled) {
          this.logger.debug('Consensus message handled', {
            messageType: message.type,
            taskId: message.taskId,
          });
        } else {
          this.logger.debug('Consensus message not handled', {
            messageType: message.type,
            error: result.error,
          });
        }
      }
    } catch (err) {
      this.logger.error('Failed to handle P2P consensus message', {
        error: err.message,
      });
    }
  }

  /**
   * Get network status
   * @returns {Object} Network status
   */
  getNetworkStatus() {
    if (!this.p2pNetwork) {
      return { connected: false, peers: [] };
    }

    return {
      connected: this.p2pNetwork.isConnected?.() || false,
      peers: this.p2pNetwork.getPeers?.() || [],
      sentMessages: this.sentMessages.size,
    };
  }

  /**
   * Cleanup routine - remove expired message tracking
   */
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, data] of this.sentMessages.entries()) {
      if (now - data.sentAt > this.messageTimeout) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.sentMessages.delete(key);
    }

    if (keysToDelete.length > 0) {
      this.logger.debug('Cleaned up sent messages', { removedCount: keysToDelete.length });
    }
  }

  /**
   * Shutdown network adapter
   */
  shutdown() {
    this.sentMessages.clear();
    this.handlers.clear();
    this.logger.info('Consensus network adapter shutdown');
  }
}

module.exports = ConsensusNetworkAdapter;
