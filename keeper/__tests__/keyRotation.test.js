const { Keypair, Networks, TransactionBuilder, Account } = require('@stellar/stellar-sdk');
const {
  beginRotation,
  completeRotation,
  buildBeginRotationTx,
  buildCompleteRotationTx,
  createTransitionKeyring,
} = require('../src/keyRotation');

// A minimal Soroban-Server test double: getAccount returns a fresh
// sequence-numbered account, sendTransaction records the submitted tx.
function makeMockServer() {
  const sent = [];
  let seq = 100;
  return {
    sent,
    async getAccount(publicKey) {
      return new Account(publicKey, String(seq++));
    },
    async sendTransaction(tx) {
      sent.push(tx);
      return { hash: 'mock-hash', status: 'PENDING' };
    },
  };
}

function signerOps(tx) {
  return tx.operations.filter((op) => op.type === 'setOptions' && op.signer);
}

describe('keyRotation (Issue #848)', () => {
  const OLD = Keypair.random();
  const NEW = Keypair.random();

  beforeAll(() => {
    process.env.NETWORK_PASSPHRASE = Networks.TESTNET;
  });

  describe('beginRotation', () => {
    it('builds a tx that ADDS the new signer without removing the old one', async () => {
      const server = makeMockServer();
      const { tx } = await beginRotation(OLD, NEW, server, { signerWeight: 1 });

      const ops = signerOps(tx);
      expect(ops).toHaveLength(1);
      // Adds the NEW key with a positive weight.
      expect(ops[0].signer.ed25519PublicKey).toBe(NEW.publicKey());
      expect(ops[0].signer.weight).toBe(1);

      // Source account is the OLD key (old key authorizes adding the new signer).
      expect(tx.source).toBe(OLD.publicKey());

      // Tx is signed by the OLD key and NOT by removing anything.
      expect(tx.signatures.length).toBe(1);
      expect(server.sent).toHaveLength(1);
    });

    it('produces a transaction verifiable as signed by the old key', async () => {
      const server = makeMockServer();
      const tx = await buildBeginRotationTx(OLD, NEW, server);
      const keyring = createTransitionKeyring(OLD);
      expect(keyring.verifyTransactionSigned(tx)).toBe(true);
    });
  });

  describe('completeRotation', () => {
    it('builds a tx that REMOVES the old signer (weight 0), signed by the new key', async () => {
      const server = makeMockServer();
      const { tx } = await completeRotation(OLD, NEW, server);

      const ops = signerOps(tx);
      expect(ops).toHaveLength(1);
      expect(ops[0].signer.ed25519PublicKey).toBe(OLD.publicKey());
      expect(ops[0].signer.weight).toBe(0); // weight 0 removes the signer

      // Source + signature come from the NEW key now.
      expect(tx.source).toBe(NEW.publicKey());
      const keyring = createTransitionKeyring(NEW);
      expect(keyring.verifyTransactionSigned(tx)).toBe(true);
    });
  });

  describe('createTransitionKeyring — accept either key during the window', () => {
    it('single-key mode is backward compatible', () => {
      const ring = createTransitionKeyring(OLD);
      expect(ring.isRotating()).toBe(false);
      expect(ring.isValidSigner(OLD.publicKey())).toBe(true);
      expect(ring.isValidSigner(NEW.publicKey())).toBe(false);
      expect(ring.getSigningKeypair()).toBe(OLD);
    });

    it('during rotation both keys are valid and new key is preferred for signing', () => {
      const ring = createTransitionKeyring(OLD, NEW);
      expect(ring.isRotating()).toBe(true);
      expect(ring.isValidSigner(OLD.publicKey())).toBe(true);
      expect(ring.isValidSigner(NEW.publicKey())).toBe(true);
      expect(ring.getSigningKeypair()).toBe(NEW);
      expect(ring.getValidPublicKeys().sort()).toEqual(
        [OLD.publicKey(), NEW.publicKey()].sort(),
      );
    });

    it('validates a transaction signed by EITHER key during the window', () => {
      const ring = createTransitionKeyring(OLD, NEW);
      const server = { }; // not needed for local build
      // Build a trivial tx signed by the old key.
      const account = new Account(OLD.publicKey(), '5');
      const { Operation, BASE_FEE } = require('@stellar/stellar-sdk');
      const txOld = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.bumpSequence({ bumpTo: '6' }))
        .setTimeout(60)
        .build();
      txOld.sign(OLD);
      expect(ring.verifyTransactionSigned(txOld)).toBe(true);

      // A tx signed by an unrelated key is rejected.
      const stranger = Keypair.random();
      const txStranger = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.bumpSequence({ bumpTo: '6' }))
        .setTimeout(60)
        .build();
      txStranger.sign(stranger);
      expect(ring.verifyTransactionSigned(txStranger)).toBe(false);
      void server;
    });
  });
});
