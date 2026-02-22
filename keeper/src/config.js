require('dotenv').config();

const requiredEnvVars = [
    'SOROBAN_RPC_URL',
    'NETWORK_PASSPHRASE',
    'KEEPER_SECRET',
    'CONTRACT_ID',
    'POLLING_INTERVAL_MS'
];

function validateEnv() {
    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

validateEnv();

module.exports = {
    rpcUrl: process.env.SOROBAN_RPC_URL,
    networkPassphrase: process.env.NETWORK_PASSPHRASE,
    keeperSecret: process.env.KEEPER_SECRET,
    contractId: process.env.CONTRACT_ID,
    pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS, 10) || 10000,
};
