'use strict';

const { parentPort, workerData } = require('worker_threads');
const metering = require('wasm-metering');

async function run() {
  const wasmBytes = Buffer.from(workerData.bytes);
  const module = await WebAssembly.compile(wasmBytes);
  const imports = WebAssembly.Module.imports(module);
  if (imports.length > 0) {
    const importName = `${imports[0].module}.${imports[0].name}`;
    const error = new Error(`WASM resolver imports blocked capability "${importName}"`);
    error.code = 'BLOCKED_CAPABILITY';
    throw error;
  }

  const metered = metering.meterWASM(wasmBytes, { meterType: 'i32' });
  const meteredModule = await WebAssembly.compile(metered);
  let fuelUsed = 0;
  let exhausted = false;
  const instance = await WebAssembly.instantiate(meteredModule, {
    metering: {
      usegas(amount) {
        fuelUsed += amount;
        if (!Number.isSafeInteger(amount) || amount < 0 || fuelUsed > workerData.maxFuel) {
          exhausted = true;
          parentPort.postMessage({ type: 'fuel-exhausted' });
          throw new Error('WASM fuel exhausted');
        }
      },
    },
  });
  const exported = instance.exports[workerData.entry];
  if (typeof exported !== 'function') {
    const error = new Error(`WASM resolver does not export "${workerData.entry}"`);
    error.code = 'INVALID_EXPORT';
    throw error;
  }

  const result = exported(...workerData.args);
  if (exhausted) {
    parentPort.postMessage({ type: 'fuel-exhausted' });
    return;
  }
  parentPort.postMessage({ type: 'result', result });
}

run().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    code: error.code,
    message: error.message,
  });
});
