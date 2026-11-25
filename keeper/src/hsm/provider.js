class HSMProvider {
  constructor(opts = {}) {
    this.logger = opts.logger || console;
  }

  // Generate a new key inside the HSM and return key id and public key
  async generateKey({ _keyId, _algorithm = 'ed25519', _usage = 'sign' } = {}) {
    throw new Error('Not implemented');
  }

  // Return public key material for keyId
  async getPublicKey(_keyId) {
    throw new Error('Not implemented');
  }

  // Request HSM to sign a digest — private key never leaves HSM
  async sign(keyId, data, _options = {}) {
    throw new Error('Not implemented');
  }

  // Rotate key material (create new version) and return new key version id
  async rotateKey(keyId, _options = {}) {
    throw new Error('Not implemented');
  }

  // Activate/deactivate key
  async activateKey(_keyId) {
    throw new Error('Not implemented');
  }

  async deactivateKey(_keyId) {
    throw new Error('Not implemented');
  }

  // List keys and metadata
  async listKeys() {
    throw new Error('Not implemented');
  }
}

module.exports = { HSMProvider };
