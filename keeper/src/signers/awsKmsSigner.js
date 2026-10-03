'use strict';

const { KMSClient, GetPublicKeyCommand, SignCommand } = require('@aws-sdk/client-Kms');

/**
 * AWS KMS-backed ED25519 signer.
 *
 * The private key never leaves KMS. We only ever ask KMS to sign a
 * digest and return the signature bytes. The public key is fetched once
 * at construction time and cached for the lifetime of the signer.
 */
class AwsKmsSigner {
  constructor(options = {}) {
    const { keyId, region, auditLogger, client } = options;
    if (!keyId) throw new Error('AwsKmsSigner: keyId is required');
    this.keyId = keyId;
    this.region = region || process.env.AWS_REGION || undefined;
    this.audit = auditLogger || null;
    this.client = client || new KMSClient(this.region ? { region: this.region } : {});
    this.publicKey = null;
    this.publicKeyPem = null;
  }

  async init() {
    const cmd = new GetPublicKeyCommand({ KeyId: this.keyId });
    const res = await this.client.send(cmd);
    if (!res.PublicKey) {
      throw new Error('AwsKmsSigner: KMS did not return a public key');
    }
    this.publicKey = Buffer.from(res.PublicKey);
    this.publicKeyPem = this.publicKey.toString('base64');
    if (this.audit) {
      this.audit.record('signer.aws_kms.init', { keyId: this.keyId });
    }
    return this;
  }

  async getPublicKey() {
    if (!this.publicKey) await this.init();
    return this.publicKey;
  }

  async sign(digest) {
    if (!this.publicKey) await this.init();
    const buf = Buffer.isBuffer(digest) ? digest : Buffer.from(digest);
    const cmd = new SignCommand({
      KeyId: this.keyId,
      Message: buf,
      MessageType: 'RAW',
      SigningAlgorithm: 'ECDSA_SHA2_256',
    });
    const res = await this.client.send(cmd);
    if (!res.Signature) {
      throw new Error('AwsKmsSigner: KMS did not return a signature');
    }
    if (this.audit) {
      this.audit.record('signer.aws_kms.sign', { keyId: this.keyId, digestLen: buf.length });
    }
    return Buffer.from(res.Signature);
  }
}

module.exports = { AwsKmsSigner };
