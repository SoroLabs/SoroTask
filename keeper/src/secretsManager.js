/**
 * Secret Zero-Leakage Protocol & Cloud Secrets Manager Integration
 *
 * Module for keeper service to load secrets dynamically from
 * AWS Secrets Manager or HashiCorp Vault.
 */

const { loadSecrets, fetchVaultSecrets, fetchAwsSecrets } = require('../../scripts/secretsManager');

module.exports = {
  loadSecrets,
  fetchVaultSecrets,
  fetchAwsSecrets,
};
