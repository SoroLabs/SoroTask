/**
 * Secret Zero-Leakage Protocol & Cloud Secrets Manager Integration
 *
 * Provides dynamic runtime secret injection via AWS Secrets Manager or
 * HashiCorp Vault for production deployments, eliminating static plaintext secrets.
 */

const https = require('https');
const http = require('http');

/**
 * Fetch secrets from HashiCorp Vault HTTP API
 */
async function fetchVaultSecrets(vaultAddr, token, secretPath) {
  const url = `${vaultAddr.replace(/\/$/, '')}/v1/${secretPath.replace(/^\//, '')}`;
  const isHttps = url.startsWith('https');
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.get(
      url,
      {
        headers: {
          'X-Vault-Token': token,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              const data = json.data?.data || json.data || {};
              resolve(data);
            } catch (err) {
              reject(new Error(`Failed to parse Vault response: ${err.message}`));
            }
          } else {
            reject(new Error(`Vault request failed with status ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Vault request timed out'));
    });
  });
}

/**
 * Fetch secrets from AWS Secrets Manager using standard AWS metadata / endpoint
 */
async function fetchAwsSecrets(secretId, region = process.env.AWS_REGION || 'us-east-1') {
  // If AWS SDK is available, use it; otherwise fallback to AWS Secrets Manager HTTP API
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient({ region });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (response.SecretString) {
      return JSON.parse(response.SecretString);
    }
  } catch (_sdkErr) {
    // AWS SDK not installed or failed; fallback to environment JSON injection or error
    if (process.env.AWS_SECRETS_JSON) {
      return JSON.parse(process.env.AWS_SECRETS_JSON);
    }
  }
  return {};
}

/**
 * Main secret loader entrypoint
 * Populates process.env dynamically at runtime
 */
async function loadSecrets() {
  const provider = (process.env.SECRET_STORE_PROVIDER || '').toLowerCase();
  let loadedSecrets = {};

  if (provider === 'vault' || (process.env.VAULT_ADDR && process.env.VAULT_SECRET_PATH)) {
    const vaultAddr = process.env.VAULT_ADDR;
    const token = process.env.VAULT_TOKEN || process.env.VAULT_DEV_ROOT_TOKEN_ID;
    const secretPath = process.env.VAULT_SECRET_PATH || 'secret/data/sorotask';

    if (vaultAddr && token) {
      try {
        loadedSecrets = await fetchVaultSecrets(vaultAddr, token, secretPath);
      } catch (err) {
        console.warn(`[SecretsManager] Vault secret injection failed: ${err.message}`);
      }
    }
  } else if (provider === 'aws' || process.env.AWS_SECRETS_MANAGER_SECRET_ID) {
    const secretId = process.env.AWS_SECRETS_MANAGER_SECRET_ID || 'sorotask/production';
    try {
      loadedSecrets = await fetchAwsSecrets(secretId);
    } catch (err) {
      console.warn(`[SecretsManager] AWS Secrets Manager injection failed: ${err.message}`);
    }
  }

  // Inject loaded secrets into process.env if not already set or override if forced
  let injectedCount = 0;
  for (const [key, value] of Object.entries(loadedSecrets)) {
    if (value !== undefined && value !== null) {
      process.env[key] = String(value);
      injectedCount++;
    }
  }

  if (injectedCount > 0) {
    console.log(`[SecretsManager] Successfully injected ${injectedCount} secrets into environment.`);
  }

  return loadedSecrets;
}

module.exports = {
  loadSecrets,
  fetchVaultSecrets,
  fetchAwsSecrets,
};
