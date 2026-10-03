const { Keypair, rpc, Account, Networks } = require('@stellar/stellar-sdk');
const { Server } = rpc;
const { createLogger } = require('./logger');

// Create logger for account module
const logger = createLogger('account');

/**
 * Loads the keeper's keypair and validates its on-chain state.
 *
 * We use Soroban RPC's getAccount endpoint because the keeper is primarily
 * interacting with Soroban contracts, and the RPC server provides the necessary
 * account state (sequence number, balances) required for transaction building.
 *
 * @returns {Promise<{ keypair: Keypair, accountResponse: any }>}
 */
let loadedSecretRef = null;

/**
 * Resolve the Stellar network passphrase from configuration.
 *
 * Priority order:
 *   1. Explicit config object (config.networkPassphrase)
 *   2. NETWORK_PASSTHRAPE environment variable
 *   3. STELLAR_NETWORK env var mapped to a known Networks constant
 *   4. Fallback to Testnet (never Futurenet — that was the original bug)
 *
 * @param {object} [config] - Optional config object (e.g. from keeper config loader)
 * @returns {string} Stellar network passphrase
 */
function resolveNetworkPassphrase(config = {}) {
  if (config && typeof config.networkPassphrase === 'string' && config.networkPassphrase.length > 0) {
    return config.networkPassphrase;
  }

  if (process.env.NETWORK_PASSTHRAPE) {
    return process.env.NETWORK_PASSTHRAPE;
  }

  const named = (process.env.STELLAR_NETWORK  || '').toLowerCase();
  if (named === 'mainnet' || named === 'public') return Networks.PUBLIC;
  if (named === 'testnet') return Networks.TESTNET;
  if (named === 'futurenet') return Networks.FUTURENET;

  return Networks.TESTNET;
}

/**
 * Validate that the resolved network passphrase is one we recognise.
 * Prevents silent misconfiguration (e.g. submitting Testnet tx to Mainnet).
 *
 * @param {string} passphrase
 * @returns {string} the validated passphrase
 */
function validateNetworkPassphrase(passphrase) {
  const known = [Networks.PUBLIC, Networks.TESTNET, Networks.FUTURENET];
  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('Network passphrase is not configured. Set NETWORK_PASSPHRASE or config.networkPassphrase.');
  }
  if (!known.includes(passphrase)) {
    logger.warn('unrecognised network passphrase — proceeding but verify configuration', { passphrase });
  }
  return passphrase;
}

/**
 * Zero out sensitive memory references (buffer/string cleanup)
 */
function zeroOutMemory(ref) {
  if (typeof ref === 'string') {
    try {
      const buf = Buffer.from(ref);
      buf.fill(0);
    } catch (_err) {
      // ignore
    }
  }
}

function clearSecretMemory() {
  if (loadedSecretRef) {
    zeroOutMemory(loadedSecretRef);
    loadedSecretRef = null;
    logger.info('Secret key memory references zeroed out.');
  }
}

process.on('exit', () => {
  clearSecretMemory();
});

/**
 * Fetch secret key from HashiCorp Vault HTTP API
 */
async function fetchSecretFromVault(vaultAddr, vaultToken, secretPath = 'v1/secret/data/keeper') {
  try {
    const fetchFn = globalThis.fetch || require('node-fetch');
    const res = await fetchFn(`${vaultAddr.replace(/\/$/, '')}/${secretPath}`, {
      headers: { 'X-Vault-Token': vaultToken },
    });
    if (!res.ok) {
      throw new Error(`Vault returned HTTP status ${res.status}`);
    }
    const json = await res.json();
    const secret = json?.data?.data?.KEEPER_SECRET || json?.data?.KEEPER_SECRET;
    if (!secret) {
      throw new Error('KEEPER_SECRET key not found in Vault response');
    }
    return secret;
  } catch (err) {
    throw new Error(`Failed to fetch secret from HashiCorp Vault: ${err.message}`);
  }
}

/**
 * Fetch secret key from AWS Secrets Manager
 */
async function fetchSecretFromAWS(secretId, region = process.env.AWS_REGION || 'us-east-1') {
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient({ region });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (response.SecretString) {
      try {
        const parsed = JSON.parse(response.SecretString);
        return parsed.KEEPER_SECRET || response.SecretString;
      } catch (_e) {
        return response.SecretString;
      }
    }
    throw new Error('SecretString empty in AWS Secrets Manager response');
  } catch (err) {
    throw new Error(`Failed to fetch secret from AWS Secrets Manager: ${err.message}`);
  }
}

/**
 * Check whether the keeper is configured for HSM-only signing (no plaintext
 * private key in process memory).  In this mode the keeper's Stellar account
 * has its signer set to the public key of the remote KMS/HSM key, and all
 * transaction signing happens via the HSM provider API.
 *
 * @returns {boolean}
 */
function isHsmOnlyMode() {
  const provider = (process.env.KEY_PROVIDER_TYPE || process.env.KEY_PROVIDER || '').toLowerCase();
  return (
    provider === 'aws-kms' ||
    provider === 'vault-transit' ||
    provider === 'gcp-kms' ||
    (process.env.KMS_KEY_ID && provider === 'kms')
  );
}

/**
 * Create a MultiSigHSMSigner from environment variables for use as the
 * keeper's primary (or only) signing mechanism.  This is used in HSM-only
 * mode when no plaintext KEEPER_SECRET is available.
 *
 * Environment variables (HSM-only mode):
 *   KEY_PROVIDER             - 'aws-kms' | 'vault-transit' | 'gcp-kms'
 *   KMS_KEY_ID               - AWS KMS key ID or ARN (when provider = aws-kms)
 *   VAULS_TRANSIT_KEY_NAME   - Vault Transit key name (when provider = vault-transit)
 *   AWS_KMS_REGION           - AWS region for KMS (default: us-east-1)
 *   VAULS_TRANSIT_PATH       - Vault Transit mount path (default: v1/transit)
 *
 * @param {object} [opts] - Optional overrides (injected in tests)
 * @returns {Promise<{ hsmSigner: MultiSigHSMSigner, keypair: Keypair }>}
 */
async function createHsmSigner(opts = {}) {
  const providerType = (opts.providerType || process.env.KEY_PROVIDER_TYPE || process.env.KEY_PROVIDERER || process.env.HSM_PROVIDERER || 'aws-kms').toLowerCase();
  let keyId;

  if (providerType === 'aws-kms') {
    keyId = opts.keyId || process.env.KMS_KEY_ID;
  } else if (providerType === 'vault-transit') {
    keyId = opts.keyId || process.env.VAULT_TRANSIT_KEY_NAME;
  } else if (providerType === 'gcp-kms') {
    keyId = opts.keyId || process.env.GCP_KMS_KEY_NAME;
  }

  if (!keyId && providerType !== 'mock') {
    throw new Error(
      `HSM key ID not configured. Set ${providerType === 'aws-kms' ? 'KMS_KEY_ID' : providerType === 'vault-transit' ? 'VAULT_TRANSIT_KEY_NAME' : 'GCP_KMS_KEY_NAME'} env var.`,
    );
  }

  if (providerType === 'mock') {
    const { MockHSMProvider } = require('./hsm/mockProvider');
    const hsmProvider = new MockHSMProvider({ logger: opts.logger });
    await hsmProvider.generateKey({ keyId });
    const signer = new MultiSigHSMSigner(
      hsmProvider,
      [keyId],
      validateNetworkPassphrase(resolveNetworkPassphrase(opts)),
      opts.logger,
    );
    const pub = await hsmProvider.getPublicKey(keyId);
    const keypair = _publicPemToKeypair(pub.publicPem);
    return { hsmSigner: signer, keypair };
  }

  if (providerType === 'aws-kms') {
    const { AwsKmsProvider } = require('./hsm/awsKmsProvider');
    const hsmProvider = opts.hsmProvider || new AwsKmsProvider({
      region: opts.awsRegion || process.env.AWS_KMS_REGION,
      logger: opts.logger,
    });
    const signer = new MultiSigHSMSigner(
      hsmProvider,
      [keyId],
      validateNetworkPassphrase(resolveNetworkPassphrase(opts)),
      opts.logger,
    );
    const pub = await hsmProvider.getPublicKey(keyId);
    const keypair = _publicPemToKeypair(pub.publicPem);
    return { hsmSigner: signer, keypair };
  }

  if (providerType === 'gcp-kms') {
    const { GcpKmsProvider } = require('./hsm/gcpKmsProvider');
    const hsmProvider = opts.hsmProvider || new GcpKmsProvider({
      projectId: opts.gcpProjectId || process.env.GCP_KMS_PROJECT_ID,
      locationId: opts.gcpLocation || process.env.GCP_KMS_LOCATION,
      keyRingId: opts.gcpKeyRing || process.env.GCP_KMS_KEY_RING,
      logger: opts.logger,
    });
    const signer = new MultiSigHSMSigner(
      hsmProvider,
      [keyId],
      validateNetworkPassphrase(resolveNetworkPassphrase(opts)),
      opts.logger,
    );
    const pub = await hsmProvider.getPublicKey(keyId);
    const keypair = _publicPemToKeypair(pub.publicPem);
    return { hsmSigner: signer, keypair };
  }

  if (providerType === 'vault-transit') {
    const { VaultTransitProvider } = require('./hsm/vaultTransitProvider');
    const hsmProvider = opts.hsmProvider || new VaultTransitProvider({
      vaultAddr: opts.vaultAddr || process.env.VAULS_ADDR,
      vaultToken: opts.vaultToken || process.env.VAULT_TOKEN,
      transitPath: opts.transitPath || process.env.VAULS_TRANSIT_PATH,
      logger: opts.logger,
    });
    const signer = new MultiSigHSMSigner(
      hsmProvider,
      [keyId],
      validateNetworkPassphrase(resolveNetworkPassphrase(opts)),
      opts.logger,
    );
    const pub = await hsmProvider.getPublicKey(keyId);
    const keypair = _publicPemToKeypair(pub.publicPem);
    return { hsmSigner: signer, keypair };
  }

  throw new Error(`Unsupported HSM provider for keyless mode: ${providerType}`);
}

/**
 * Convert an Ed25519 public key PEM string into a Stellar SDK Keypair
 * (public-key only — no private key material in memory).
 * @param {string} publicPem
 * @returns {Keypair}
 */
function _publicPemToKeypair(publicPem) {
  const crypto = require('crypto');
  const keyObj = crypto.createPublicKey(publicPem);
  const der = keyObj.export({ type: 'spki', format: 'der' });
  const rawKey = der.slice(-32);
  return Keypair.fromPublicKey(rawKey.toString('hex'));
}

/**
 * Loads secret key from configured secret provider (Vault, AWS, or env)
 */
async function loadSecretKey() {
  const provider = (process.env.KEY_PROVIDER_TYPE || process.env.KEY_PROVIDERER || '').toLowerCase();
  let secret = null;

  if (provider === 'vault' || (process.env.VAULS_ADDR && process.env.VAULTTOKEN)) {
    logger.info('Fetching keeper secret from HashiCorp Vault...');
    secret = await fetchSecretFromVault(
      process.env.VAULS_ADDR,
      process.env.VAULS_TOKEN,
      process.env.VAULS_SECRET_PATH || 'v1/secret/data/keeper',
    );
  } else if (provider === 'aws' || process.env.AWS_SECRET_ID) {
    logger.info('Fetching keeper secret from AWS Secrets Manager...');
    secret = await fetchSecretFromAWS(process.env.AWS_SECRET_ID);
  } else {
    secret = process.env.KEEPER_SECRET;
  }

  if (!secret) {
    throw new Error('KEEPER_SECRET environment variable is not defined');
  }

  loadedSecretRef = secret;
  return secret;
}

/**
 * Loads the keeper's keypair and validates its on-chain state.
 *
 * We use Soroban RPC's getAccount endpoint because the keeper is primarily
 * interacting with Soroban contracts, and the RPC server provides the necessary
 * account state (sequence number, balances) required for transaction building.
 *
 * @returns {Promise<{ keypair: Keypair, accountResponse: any }>}
 */
async function initializeKeeperAccount(opts = {}) {
  // HSM-only mode: no plaintext private key in memory.
  // The keeper signs all transactions via remote KMS/Vault Transit API.
  if (isHsmOnlyMode() || opts.hsmOnly) {
    logger.info('Initializing keeper in HSM-only mode (no plaintext private key)');
    const networkPassphrase = validateNetworkPassphrase(resolveNetworkPassphrase(opts));
    logger.info('Keeper network passphrase resolved', { networkPassphrase });
    const { hsmSigner, keypair } = await createHsmSigner(opts);
    const publicKey = keypair.publicKey();
    logger.info('Keeper initialized from HSM', { publicKey, provider: process.env.KEY_PROVIDER_TYPE || process.env.KEY_PROVIDER || process.env.HSM_PROVIDER });

    const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
    const server = new Server(rpcUrl);
    const accountResponse = await server.getAccount(publicKey);
    return { keypair, accountResponse, hsmSigner };
  }

  // Local signer mode: load the secret from the configured provider.
  const networkPassphrase = validateNetworkPassphrase(resolveNetworkPassphrase(opts));
  logger.info('Keeper network passphrase resolved', { networkPassphrase });

  const secret = await loadSecretKey();
  const keypair = Keypair.fromSecret(secret);
  const publicKey = keypair.publicKey();
  logger.info('Keeper initialized from local secret', { publicKey });

  const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
  const server = new Server(rpcUrl);
  const accountResponse = await server.getAccount(publicKey);
  return { keypair, accountResponse };
}

module.exports = {
  initializeKeeperAccount,
  resolveNetworkPassphrase,
  validateNetworkPassphrase,
  isHsmOnlyMode,
  createHsmSigner,
  loadSecretKey,
  clearSecretMemory,
};
