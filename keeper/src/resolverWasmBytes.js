'use strict';

function decodeWasmBase64(encoded) {
  return Buffer.from(encoded, 'base64');
}

module.exports = { decodeWasmBase64 };
