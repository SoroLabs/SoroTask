'use strict';

const { parentPort } = require('worker_threads');
const crypto = require('crypto');

// Deterministic witness/proof derivation keyed on the task condition and client data.
// Output is bounded in size so per-task memory stays predictable under burst load.
const MAX_INPUT_BYTES = 64 * 1024;

function toHexField(buf) {
  return '0x' + buf.toString('hex');
}

function deriveField(seed, label) {
  return toHexField(
    crypto.createHash('sha256').update(label).update(seed).digest()
  );
}

function serializeInput(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof str !== 'string') {
    throw new Error('Invalid input: not serializable');
  }
  if (Buffer.byteLength(str, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error('Input exceeds maximum allowed size');
  }
  return str;
}

function generateProof(taskCondition, clientData) {
  const condition = serializeInput(taskCondition ?? null);
  const data = serializeInput(clientData ?? null);

  const seed = crypto
    .createHash('sha256')
    .update(condition)
    .update('\x00')
    .update(data)
    .digest();

  return {
    proofId: crypto.randomUUID(),
    status: 'success',
    pi_a: [deriveField(seed, 'pi_a0'), deriveField(seed, 'pi_a1')],
    pi_b: [
      [deriveField(seed, 'pi_b00'), deriveField(seed, 'pi_b01')],
      [deriveField(seed, 'pi_b10'), deriveField(seed, 'pi_b11')],
    ],
    pi_c: [deriveField(seed, 'pi_c0'), deriveField(seed, 'pi_c1')],
    publicSignals: [deriveField(seed, 'public0')],
  };
}

parentPort.on('message', (message) => {
  const id = message && message.id;
  try {
    const { taskCondition, clientData } = message || {};
    const proof = generateProof(taskCondition, clientData);
    parentPort.postMessage({ id, proof });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message || String(error) });
  }
});
