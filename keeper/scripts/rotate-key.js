#!/usr/bin/env node

/**
 * Operator CLI for zero-downtime keeper signing-key rotation (Issue #848).
 *
 * Uses native Stellar multi-signature (see src/keyRotation.js). Two phases:
 *
 *   1) begin    Add the NEW key as an additional signer on the keeper account,
 *               signed by the OLD key. After this confirms, set
 *               KEEPER_ROTATION_NEXT_SECRET=<new secret> on the running keeper
 *               so it accepts BOTH keys during the transition window.
 *
 *   2) complete Remove the OLD key as a signer, signed by the NEW key. Run this
 *               only after the new key is confirmed active. Afterwards promote
 *               the new key to KEEPER_SECRET and drop KEEPER_ROTATION_NEXT_SECRET.
 *
 * Usage:
 *   OLD_KEEPER_SECRET=S... NEW_KEEPER_SECRET=S... node scripts/rotate-key.js begin
 *   OLD_KEEPER_SECRET=S... NEW_KEEPER_SECRET=S... node scripts/rotate-key.js complete
 *
 * Env:
 *   SOROBAN_RPC_URL      RPC endpoint (default https://soroban-testnet.stellar.org)
 *   NETWORK_PASSPHRASE   network passphrase (default Testnet)
 *   SIGNER_WEIGHT        weight for the new signer on `begin` (default 1)
 */

const { Keypair, rpc } = require('@stellar/stellar-sdk');
const { beginRotation, completeRotation } = require('../src/keyRotation');

function requireSecret(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}`);
    process.exit(2);
  }
  try {
    return Keypair.fromSecret(v);
  } catch (_e) {
    console.error(`${name} is not a valid Stellar secret key`);
    process.exit(2);
  }
}

async function main() {
  const phase = process.argv[2];
  if (!['begin', 'complete'].includes(phase)) {
    console.error('Usage: rotate-key.js <begin|complete>');
    process.exit(2);
  }

  const oldKp = requireSecret('OLD_KEEPER_SECRET');
  const newKp = requireSecret('NEW_KEEPER_SECRET');

  const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
  const server = new rpc.Server(rpcUrl);

  const opts = {};
  if (process.env.SIGNER_WEIGHT) {
    opts.signerWeight = parseInt(process.env.SIGNER_WEIGHT, 10);
  }

  if (phase === 'begin') {
    console.log(`Adding new signer ${newKp.publicKey()} to account ${oldKp.publicKey()} ...`);
    const { sendResult } = await beginRotation(oldKp, newKp, server, opts);
    console.log('Submitted:', JSON.stringify({ hash: sendResult.hash, status: sendResult.status }));
    console.log('Next: set KEEPER_ROTATION_NEXT_SECRET=<new secret> on the keeper, then run "complete".');
  } else {
    console.log(`Removing old signer ${oldKp.publicKey()} using new key ${newKp.publicKey()} ...`);
    const { sendResult } = await completeRotation(oldKp, newKp, server, opts);
    console.log('Submitted:', JSON.stringify({ hash: sendResult.hash, status: sendResult.status }));
    console.log('Next: promote NEW key to KEEPER_SECRET and unset KEEPER_ROTATION_NEXT_SECRET.');
  }
}

main().catch((err) => {
  console.error('Rotation failed:', err.message);
  process.exit(1);
});
