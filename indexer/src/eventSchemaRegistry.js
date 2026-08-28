'use strict';

/**
 * eventSchemaRegistry.js — Multi-Version Contract Event Deserializer & Schema Evolution Registry
 *
 * Provides versioned event decoders that can parse events from different
 * contract versions simultaneously. Maps ledger sequence ranges to decoder
 * versions, allowing historical V1 events and modern V2 events to be
 * parsed without errors.
 *
 * When an unknown event version is encountered, the system falls back
 * to generic raw XDR parsing to ensure no events are lost.
 *
 * Usage:
 *   const registry = new EventSchemaRegistry();
 *   const decoded = registry.decodeEvent(eventName, topics, data, ledgerSequence);
 */

const { scValToNative, xdr } = require('@stellar/stellar-sdk');
const { createLogger } = require('./logger');

/**
 * Schema version definition
 * @typedef {Object} SchemaVersion
 * @property {string} version - Version identifier (e.g., 'v1', 'v2')
 * @property {number} startLedger - First ledger where this version applies
 * @property {number|null} endLedger - Last ledger (null for current version)
 * @property {Function} decoder - Decoder function for this version
 */

/**
 * Decode result
 * @typedef {Object} DecodeResult
 * @property {string} eventName - Event name
 * @property {number} taskId - Task ID
 * @property {Object} data - Decoded event data
 * @property {string} version - Schema version used for decoding
 * @property {boolean} isFallback - True if fallback raw XDR parsing was used
 */

class EventSchemaRegistry {
  /**
   * @param {object} options
   * @param {object} [options.logger] - Pino-compatible logger
   */
  constructor(options = {}) {
    this.logger = options.logger || createLogger('event-schema-registry');

    /**
     * Registered schema versions
     * @type {Map<string, SchemaVersion[]>}
     * Key: event name (e.g., 'TaskRegistered')
     * Value: Array of schema versions, ordered by startLedger ascending
     */
    this.schemas = new Map();

    /**
     * Contract version mapping
     * Maps ledger ranges to contract versions for routing
     * @type {Array<{ startLedger: number, endLedger: number|null, version: string }>}
     */
    this.contractVersions = [];

    /**
     * Statistics
     */
    this.stats = {
      decoded: 0,
      fallbacks: 0,
      errors: 0,
      byVersion: {},
      byEvent: {},
    };

    // Register built-in schemas
    this._registerBuiltinSchemas();
  }

  /**
   * Decode an event using the appropriate versioned decoder.
   *
   * @param {string} eventName - The event name from topics[0]
   * @param {Array} topics - Raw XDR topics (base64 strings)
   * @param {string} value - Raw XDR value (base64 string)
   * @param {number} ledgerSequence - The ledger sequence for version routing
   * @returns {DecodeResult}
   */
  decodeEvent(eventName, topics, value, ledgerSequence) {
    try {
      // Decode topics to native values
      const decodedTopics = topics.map(t => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));
      
      // Extract version from topics (if present)
      const eventVersion = this._extractVersionFromTopics(decodedTopics);
      
      // Find the appropriate decoder
      const decoder = this._findDecoder(eventName, eventVersion, ledgerSequence);
      
      if (decoder) {
        const result = decoder.decode(decodedTopics, value, ledgerSequence);
        this.stats.decoded++;
        this.stats.byVersion[result.version] = (this.stats.byVersion[result.version] || 0) + 1;
        this.stats.byEvent[eventName] = (this.stats.byEvent[eventName] || 0) + 1;
        return result;
      }
      
      // Fallback to raw XDR parsing
      return this._fallbackDecode(eventName, decodedTopics, value, ledgerSequence);
    } catch (err) {
      this.stats.errors++;
      this.logger.error('Event decode error', {
        eventName,
        ledgerSequence,
        error: err.message,
      });
      
      // Return fallback result even on error
      return this._fallbackDecode(eventName, [], value, ledgerSequence);
    }
  }

  /**
   * Register a custom schema version for an event.
   *
   * @param {string} eventName - Event name
   * @param {SchemaVersion} schema - Schema version definition
   */
  registerSchema(eventName, schema) {
    if (!this.schemas.has(eventName)) {
      this.schemas.set(eventName, []);
    }

    const versions = this.schemas.get(eventName);
    versions.push(schema);
    
    // Sort by startLedger ascending
    versions.sort((a, b) => a.startLedger - b.startLedger);

    this.logger.info('Registered event schema', {
      eventName,
      version: schema.version,
      startLedger: schema.startLedger,
      endLedger: schema.endLedger,
    });
  }

  /**
   * Register a contract version mapping.
   *
   * @param {number} startLedger - First ledger
   * @param {number|null} endLedger - Last ledger (null for current)
   * @param {string} version - Contract version identifier
   */
  registerContractVersion(startLedger, endLedger, version) {
    this.contractVersions.push({ startLedger, endLedger, version });
    this.contractVersions.sort((a, b) => a.startLedger - b.startLedger);
    
    this.logger.info('Registered contract version', {
      version,
      startLedger,
      endLedger,
    });
  }

  /**
   * Get all registered schemas (for debugging/inspection).
   *
   * @returns {Map<string, SchemaVersion[]>}
   */
  getSchemas() {
    return new Map(this.schemas);
  }

  /**
   * Get statistics.
   *
   * @returns {object}
   */
  getStats() {
    return { ...this.stats };
  }

  // ─── Internal Methods ──────────────────────────────────────────────────────

  /**
   * Register built-in event schemas for all known event types.
   */
  _registerBuiltinSchemas() {
    // TaskRegistered V1 (original)
    this.registerSchema('TaskRegistered', {
      version: 'v1',
      startLedger: 0,
      endLedger: null,
      decode: (topics, _value, _ledger) => ({
        eventName: 'TaskRegistered',
        taskId: Number(topics[2]),
        data: { creator: topics[1] },
        version: 'v1',
        isFallback: false,
      }),
    });

    // TaskExecuted V1 (original)
    this.registerSchema('TaskExecuted', {
      version: 'v1',
      startLedger: 0,
      endLedger: null,
      decode: (topics, _value, _ledger) => ({
        eventName: 'TaskExecuted',
        taskId: Number(topics[2]),
        data: { creator: topics[1] },
        version: 'v1',
        isFallback: false,
      }),
    });

    // TaskPaused V1 (original)
    this.registerSchema('TaskPaused', {
      version: 'v1',
      startLedger: 0,
      endLedger: null,
      decode: (topics, _value, _ledger) => ({
        eventName: 'TaskPaused',
        taskId: Number(topics[2]),
        data: { creator: topics[1] },
        version: 'v1',
        isFallback: false,
      }),
    });

    // TaskResumed V1 (original)
    this.registerSchema('TaskResumed', {
      version: 'v1',
      startLedger: 0,
      endLedger: null,
      decode: (topics, _value, _ledger) => ({
        eventName: 'TaskResumed',
        taskId: Number(topics[2]),
        data: { creator: topics[1] },
        version: 'v1',
        isFallback: false,
      }),
    });

    // TaskCancelled V1 (original)
    this.registerSchema('TaskCancelled', {
      version: 'v1',
      startLedger: 0,
      endLedger: null,
      decode: (topics, _value, _ledger) => ({
        eventName: 'TaskCancelled',
        taskId: Number(topics[2]),
        data: { creator: topics[1] },
        version: 'v1',
        isFallback: false,
      }),
    });

    // ContractInitialized V1 (original)
    this.registerSchema('ContractInitialized', {
      version: 'v1',
      startLedger: 0,
      endLedger: null,
      decode: (topics, _value, _ledger) => {
        const data = scValToNative(xdr.ScVal.fromXDR(_value, 'base64'));
        return {
          eventName: 'ContractInitialized',
          taskId: 0,
          data: { token: data[0] },
          version: 'v1',
          isFallback: false,
        };
      },
    });

    // KeeperPaid V1 (original)
    this.registerSchema('KeeperPaid', {
      version: 'v1',
      startLedger: 0,
      endLedger: null,
      decode: (topics, _value, _ledger) => {
        const data = scValToNative(xdr.ScVal.fromXDR(_value, 'base64'));
        return {
          eventName: 'KeeperPaid',
          taskId: Number(topics[2]),
          data: {
            keeper: data[0],
            fee: data[1] ? data[1].toString() : '0',
          },
          version: 'v1',
          isFallback: false,
        };
      },
    });

    // GasDeposited V1 (original)
    this.registerSchema('GasDeposited', {
      version: 'v1',
      startLedger: 0,
      endLedger: null,
      decode: (topics, _value, _ledger) => {
        const data = scValToNative(xdr.ScVal.fromXDR(_value, 'base64'));
        return {
          eventName: 'GasDeposited',
          taskId: Number(topics[2]),
          data: {
            address: data[0],
            amount: data[1] ? data[1].toString() : '0',
          },
          version: 'v1',
          isFallback: false,
        };
      },
    });

    // GasWithdrawn V1 (original)
    this.registerSchema('GasWithdrawn', {
      version: 'v1',
      startLedger: 0,
      endLedger: null,
      decode: (topics, _value, _ledger) => {
        const data = scValToNative(xdr.ScVal.fromXDR(_value, 'base64'));
        return {
          eventName: 'GasWithdrawn',
          taskId: Number(topics[2]),
          data: {
            address: data[0],
            amount: data[1] ? data[1].toString() : '0',
          },
          version: 'v1',
          isFallback: false,
        };
      },
    });
  }

  /**
   * Extract version identifier from decoded topics.
   * Version markers look like 'v1', 'v2', etc. in topics[1].
   *
   * @param {Array} topics - Decoded topics
   * @returns {string|null} - Version string or null
   */
  _extractVersionFromTopics(topics) {
    if (topics.length > 1 && typeof topics[1] === 'string') {
      const match = topics[1].match(/^v(\d+)$/);
      if (match) {
        return topics[1];
      }
    }
    return null;
  }

  /**
   * Find the appropriate decoder for an event based on version and ledger.
   *
   * @param {string} eventName - Event name
   * @param {string|null} eventVersion - Version from topics (e.g., 'v2')
   * @param {number} ledgerSequence - Current ledger sequence
   * @returns {SchemaVersion|null}
   */
  _findDecoder(eventName, eventVersion, ledgerSequence) {
    const versions = this.schemas.get(eventName);
    if (!versions || versions.length === 0) {
      return null;
    }

    // If version marker is present, find matching schema
    if (eventVersion) {
      for (const schema of versions) {
        if (schema.version === eventVersion) {
          return schema;
        }
      }
    }

    // Find schema by ledger range
    for (const schema of versions) {
      if (ledgerSequence >= schema.startLedger) {
        if (schema.endLedger === null || ledgerSequence <= schema.endLedger) {
          return schema;
        }
      }
    }

    // Return the latest version as fallback
    return versions[versions.length - 1];
  }

  /**
   * Fallback decoder for unknown event versions.
   * Parses raw XDR to extract basic information.
   *
   * @param {string} eventName - Event name
   * @param {Array} decodedTopics - Decoded topics
   * @param {string} value - Raw XDR value
   * @param {number} ledgerSequence - Ledger sequence
   * @returns {DecodeResult}
   */
  _fallbackDecode(eventName, decodedTopics, value, ledgerSequence) {
    this.stats.fallbacks++;
    
    this.logger.warn('Using fallback XDR decoder', {
      eventName,
      ledgerSequence,
      topicCount: decodedTopics.length,
    });

    // Try to extract task ID from topics (best effort)
    let taskId = 0;
    if (decodedTopics.length > 2 && typeof decodedTopics[2] === 'number') {
      taskId = decodedTopics[2];
    } else if (decodedTopics.length > 1 && typeof decodedTopics[1] === 'number') {
      taskId = decodedTopics[1];
    }

    // Try to decode value (best effort)
    let rawData = {};
    try {
      if (value) {
        const nativeData = scValToNative(xdr.ScVal.fromXDR(value, 'base64'));
        rawData = { raw: nativeData };
      }
    } catch (err) {
      rawData = { error: 'Failed to decode XDR', value };
    }

    return {
      eventName,
      taskId,
      data: rawData,
      version: 'fallback',
      isFallback: true,
    };
  }
}

module.exports = { EventSchemaRegistry };
