const { SorobanRpc } = require('@stellar/stellar-sdk');
const config = require('./config');

/**
 * Initialized Soroban RPC Server instance.
 * Used for querying contract state and submitting transactions.
 */
const server = new SorobanRpc.Server(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith('http://'),
});

module.exports = {
    server,
};
