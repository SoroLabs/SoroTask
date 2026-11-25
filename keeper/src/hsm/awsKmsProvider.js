const { HSMProvider } = require('./provider');

class AwsKmsProvider extends HSMProvider {
  constructor(opts = {}) {
    super(opts);
    this.region = opts.region || process.env.AWS_KMS_REGION || 'us-east-1';
    this.clientConfig = opts.clientConfig || {};
  }

  _getClient() {
    if (!this._client) {
      const { KMSClient } = require('@aws-sdk/client-kms');
      this._client = new KMSClient({
        region: this.region,
        ...this.clientConfig,
      });
    }
    return this._client;
  }

  _derToPem(derPublicKey) {
    const derBuf = Buffer.isBuffer(derPublicKey) ? derPublicKey : Buffer.from(derPublicKey);
    const base64 = derBuf.toString('base64');
    const lines = ['-----BEGIN PUBLIC KEY-----'];
    for (let i = 0; i < base64.length; i += 64) {
      lines.push(base64.slice(i, i + 64));
    }
    lines.push('-----END PUBLIC KEY-----');
    return lines.join('\n');
  }

  async generateKey({ keyId, algorithm = 'ED25519', usage = 'SIGN_VERIFY' } = {}) {
    const { CreateKeyCommand } = require('@aws-sdk/client-kms');
    const client = this._getClient();
    const result = await client.send(new CreateKeyCommand({
      KeySpec: algorithm,
      KeyUsage: usage,
      Description: keyId ? `SoroTask keeper key: ${keyId}` : 'SoroTask keeper key',
      ...(keyId ? { Tags: [{ TagKey: 'Name', TagValue: keyId }] } : {}),
    }));
    const keyMetadata = result.KeyMetadata;
    const keyIdResponse = keyMetadata.KeyId;
    const publicKey = await this.getPublicKey(keyIdResponse);
    return { keyId: keyIdResponse, publicPem: publicKey.publicPem };
  }

  async getPublicKey(keyId) {
    const { GetPublicKeyCommand } = require('@aws-sdk/client-kms');
    const client = this._getClient();
    const result = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
    const publicPem = this._derToPem(result.PublicKey);
    return { keyId, publicPem, active: true };
  }

  async sign(keyId, data, _options = {}) {
    const { SignCommand } = require('@aws-sdk/client-kms');
    const client = this._getClient();
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    const result = await client.send(new SignCommand({
      KeyId: keyId,
      Message: buf,
      MessageType: 'DIGEST',
      SigningAlgorithm: 'ED25519',
    }));
    return Buffer.from(result.Signature);
  }

  async rotateKey(keyId, _options = {}) {
    const { RotateKeyOnDemandCommand } = require('@aws-sdk/client-kms');
    const client = this._getClient();
    await client.send(new RotateKeyOnDemandCommand({ KeyId: keyId }));
    const publicKey = await this.getPublicKey(keyId);
    return { keyId, publicPem: publicKey.publicPem };
  }

  async activateKey(keyId) {
    const { EnableKeyCommand } = require('@aws-sdk/client-kms');
    const client = this._getClient();
    await client.send(new EnableKeyCommand({ KeyId: keyId }));
    return { keyId, active: true };
  }

  async deactivateKey(keyId) {
    const { DisableKeyCommand } = require('@aws-sdk/client-kms');
    const client = this._getClient();
    await client.send(new DisableKeyCommand({ KeyId: keyId }));
    return { keyId, active: false };
  }

  async listKeys() {
    const { ListKeysCommand } = require('@aws-sdk/client-kms');
    const client = this._getClient();
    const result = await client.send(new ListKeysCommand({}));
    const keys = result.Keys || [];
    const enriched = [];
    for (const key of keys) {
      enriched.push({
        keyId: key.KeyId,
        keyArn: key.KeyArn,
        active: true,
        createdAt: key.CreationDate ? key.CreationDate.toISOString() : null,
      });
    }
    return enriched;
  }
}

module.exports = { AwsKmsProvider };
