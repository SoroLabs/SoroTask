/**
 * Distributed Keeper Consensus Engine
 * Main package export
 */

const ConsensusEngine = require('./engine');
const Voter = require('./voter');
const Proposer = require('./proposer');
const ConsensusLedger = require('./ledger');
const ConsensusExecutor = require('./executor-wrapper');
const ConsensusNetworkAdapter = require('./network-adapter');
const {
  MESSAGE_TYPES,
  createMessage,
  signMessage,
  verifySignature,
  createProposalMessage,
  createVoteMessage,
  createCommitMessage,
  createResultMessage,
} = require('./messages');

module.exports = {
  // Main components
  ConsensusEngine,
  Voter,
  Proposer,
  ConsensusLedger,
  ConsensusExecutor,
  ConsensusNetworkAdapter,

  // Message utilities
  MESSAGE_TYPES,
  createMessage,
  signMessage,
  verifySignature,
  createProposalMessage,
  createVoteMessage,
  createCommitMessage,
  createResultMessage,

  // Version
  version: '1.0.0',
};
