const { Readable, Transform } = require('stream');
const { createUnzip } = require('zlib');
const { pipeline } = require('stream/promises');
const errorHandler = require('./errorHandler');

const MAX_COMPRESSED_SIZE = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED_SIZE = 10 * 1024 * 1024;
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const CONTRACT_SPEC_SECTION = 'contractspecv0';

class ContractSpecError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContractSpecError';
    this.code = code;
    this.status = 422;
    this.statusCode = 422;
  }
}

class SizeLimitTransform extends Transform {
  constructor(limit, label) {
    super();
    this.limit = limit;
    this.label = label;
    this.size = 0;
  }

  _transform(chunk, encoding, callback) {
    this.size += chunk.length;
    if (this.size > this.limit) {
      callback(new Error(`${this.label} exceeds ${this.limit} bytes`));
      return;
    }
    callback(null, chunk);
  }
}

class Parser {
  /**
   * Extracts and standardizes ABI from raw contract data.
   * @param {Object} rawData - Mock raw contract data
   * @returns {Object|null} - Standardized ABI object or null if extraction fails
   */
  extractABI(rawData) {
    try {
      if (!rawData || !rawData.bytecode) {
        throw new Error('Raw data missing bytecode');
      }

      if (Buffer.isBuffer(rawData.bytecode) || rawData.bytecode instanceof Uint8Array || rawData.bytecode instanceof Readable) {
        return this.extractFromWasm(rawData);
      }
      
      // Simulated parsing logic
      // In a real implementation, this would involve decoding Wasm or EVM bytecode
      if (rawData.simulatedError) {
         throw new Error('Simulated parsing error');
      }

      const abi = {
        functions: rawData.mockFunctions || [],
        events: rawData.mockEvents || [],
        version: "1.0.0"
      };

      console.log(`[Parser] Successfully extracted ABI`);
      return abi;
    } catch (err) {
      this.lastError = this.toStructuredError(err);
      errorHandler.logError('Parser', err);
      return null;
    }
  }

  async extractFromWasm(rawData) {
    try {
      const source = rawData.bytecode;
      if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
        const bytes = Buffer.from(source);
        if (bytes.subarray(0, WASM_MAGIC.length).equals(WASM_MAGIC)) {
          if (bytes.length > MAX_UNCOMPRESSED_SIZE) {
            throw new Error(`Uncompressed bytecode exceeds ${MAX_UNCOMPRESSED_SIZE} bytes`);
          }
          this.validateWasm(bytes);
          return this.createABI(rawData);
        }
        if (bytes.length > MAX_COMPRESSED_SIZE) {
          throw new Error(`Compressed bytecode exceeds ${MAX_COMPRESSED_SIZE} bytes`);
        }
      }

      const input = new SizeLimitTransform(MAX_COMPRESSED_SIZE, 'Compressed bytecode');
      const output = new SizeLimitTransform(MAX_UNCOMPRESSED_SIZE, 'Uncompressed bytecode');
      const chunks = [];
      output.on('data', chunk => chunks.push(chunk));

      const inputStream = Buffer.isBuffer(source) || source instanceof Uint8Array
        ? Readable.from([source])
        : source;
      await pipeline(inputStream, input, createUnzip(), output);
      const wasm = Buffer.concat(chunks);

      this.validateWasm(wasm);

      if (rawData.simulatedError) {
        throw new Error('Simulated parsing error');
      }

      return this.createABI(rawData);
    } catch (err) {
      this.lastError = this.toStructuredError(err);
      errorHandler.logError('Parser', err);
      return null;
    }
  }

  async extractABIResponse(rawData) {
    const abi = await this.extractABI(rawData);
    if (abi) return { status: 200, body: abi };
    return { status: 422, body: { error: this.lastError || { code: 'INVALID_CONTRACT_SPEC', message: 'Invalid contract specification' } } };
  }

  toStructuredError(error) {
    return {
      code: error.code || 'INVALID_CONTRACT_SPEC',
      message: error.message || String(error),
      status: error.status || 422
    };
  }

  validateWasm(wasm) {
    if (!Buffer.isBuffer(wasm) || wasm.length < 8 || !wasm.subarray(0, WASM_MAGIC.length).equals(WASM_MAGIC)) {
      throw new ContractSpecError('INVALID_WASM', 'Invalid WASM magic bytes');
    }

    let offset = 8;
    while (offset < wasm.length) {
      const sectionId = wasm[offset++];
      const size = this.readUnsignedLeb128(wasm, offset, 'SECTION_SIZE');
      offset = size.nextOffset;
      const sectionEnd = offset + size.value;

      if (sectionEnd > wasm.length) {
        throw new ContractSpecError('SECTION_OUT_OF_BOUNDS', 'WASM section exceeds bytecode bounds');
      }

      if (sectionId === 0) {
        const nameLength = this.readUnsignedLeb128(wasm, offset, 'CUSTOM_NAME_LENGTH');
        const nameStart = nameLength.nextOffset;
        const nameEnd = nameStart + nameLength.value;
        if (nameEnd > sectionEnd) {
          throw new ContractSpecError('CUSTOM_SECTION_OUT_OF_BOUNDS', 'WASM custom section name exceeds section bounds');
        }

        const sectionName = wasm.toString('utf8', nameStart, nameEnd);
        if (sectionName === CONTRACT_SPEC_SECTION && nameEnd === sectionEnd) {
          throw new ContractSpecError('INVALID_CONTRACT_SPEC', 'contractspecv0 section is empty');
        }
      }

      offset = sectionEnd;
    }
  }

  readUnsignedLeb128(buffer, offset, code) {
    let value = 0;
    let shift = 0;
    while (offset < buffer.length && shift <= 49) {
      const byte = buffer[offset++];
      value += (byte & 0x7f) * (2 ** shift);
      if ((byte & 0x80) === 0) {
        return { value, nextOffset: offset };
      }
      shift += 7;
    }
    throw new ContractSpecError(code, 'Malformed or truncated WASM length encoding');
  }

  createABI(rawData) {
    this.lastError = null;
    const abi = {
      functions: rawData.mockFunctions || [],
      events: rawData.mockEvents || [],
      version: '1.0.0'
    };

    console.log('[Parser] Successfully extracted ABI');
    return abi;
  }
}

const parser = new Parser();
parser.ContractSpecError = ContractSpecError;
parser.MAX_COMPRESSED_SIZE = MAX_COMPRESSED_SIZE;
parser.MAX_UNCOMPRESSED_SIZE = MAX_UNCOMPRESSED_SIZE;
module.exports = parser;
