'use strict';

const { parentPort } = require('worker_threads');
const crypto = require('crypto');

parentPort.on('message', ({ taskCondition, clientData }) => {
  try {
    const proof = {
      proofId: crypto.randomUUID(),
      status: 'success',
      pi_a: ['0x1', '0x2'],
      pi_b: [['0x3', '0x4'], ['0x5', '0x6']],
      pi_c: ['0x7', '0x8'],
      publicSignals: ['0x9'],
    };

    setTimeout(() => parentPort.postMessage({ proof }), 100);
  } catch (error) {
    parentPort.postMessage({ error: error.message || String(error) });
  }
});
