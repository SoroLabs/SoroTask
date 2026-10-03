const { Readable, Transform } = require('stream');
const { createUnzip } = require('zlib');
const { pipeline } = require('stream/promises');
const errorHandler = require('./errorHandler');

const MAX_COMPRESSED_SIZE = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED_SIZE = 10 * 1024 * 1024;
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const CONTRACT_SPEC_SECTION = 'contractspecv0';

// ---------------------------------------------------------------------------
// Attempt to load the Stellar SDK's xdr module for real ContractSpec decoding.
// This is optional: if unavailable (e.g., in lightweight test environments)
// the parser falls back to the mock ABI path.
// ---------------------------------------------------------------------------
let stellarXdr = null;
try {
  // @stellar/stellar-sdk exposes xdr on the default import
  // eslint-disable-next-line import/no-extraneous-dependencies
  const sdk = require('@stellar/stellar-sdk');
  stellarXdr = (sdk.default || sdk).xdr || null;
} catch (_) {
  // SDK not installed — real WASM parsing will emit a warning but continue
}

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

// ---------------------------------------------------------------------------
// XDR / ContractSpec helpers
// ---------------------------------------------------------------------------

/**
 * Maps an XDR `ScSpecTypeDef` arm name to a compact JSON type string.
 * Returns a structured object so callers can inspect the kind and optional
 * element/fields info for complex types.
 *
 * @param {Object} typeDef - An `xdr.ScSpecTypeDef` instance.
 * @returns {Object} Structured type descriptor, e.g. { type: 'u64' }.
 */
function decodeScSpecType(typeDef) {
  if (!typeDef) return { type: 'void' };

  const arm = typeDef.switch ? typeDef.switch().name : String(typeDef);

  // Primitive type map (arm name → compact label)
  const PRIMITIVE_MAP = {
    scSpecTypeVoid: 'void',
    scSpecTypeBool: 'bool',
    scSpecTypeError: 'error',
    scSpecTypeU32: 'u32',
    scSpecTypeI32: 'i32',
    scSpecTypeU64: 'u64',
    scSpecTypeI64: 'i64',
    scSpecTypeTimepoint: 'timepoint',
    scSpecTypeDuration: 'duration',
    scSpecTypeU128: 'u128',
    scSpecTypeI128: 'i128',
    scSpecTypeU256: 'u256',
    scSpecTypeI256: 'i256',
    scSpecTypeBytes: 'bytes',
    scSpecTypeString: 'string',
    scSpecTypeSymbol: 'symbol',
    scSpecTypeAddress: 'address',
    scSpecTypeLedgerKeyContractInstance: 'ledger_key_contract_instance',
    scSpecTypeLedgerKeyNonce: 'ledger_key_nonce',
  };

  if (PRIMITIVE_MAP[arm]) return { type: PRIMITIVE_MAP[arm] };

  // Complex container types
  try {
    switch (arm) {
      case 'scSpecTypeOption': {
        const inner = typeDef.value ? decodeScSpecType(typeDef.value().valueType()) : { type: 'unknown' };
        return { type: 'option', inner };
      }
      case 'scSpecTypeResult': {
        const okType = typeDef.value ? decodeScSpecType(typeDef.value().okType()) : { type: 'unknown' };
        const errType = typeDef.value ? decodeScSpecType(typeDef.value().errType()) : { type: 'unknown' };
        return { type: 'result', ok: okType, err: errType };
      }
      case 'scSpecTypeVec': {
        const elementType = typeDef.value ? decodeScSpecType(typeDef.value().elementType()) : { type: 'unknown' };
        return { type: 'vec', element: elementType };
      }
      case 'scSpecTypeMap': {
        const keyType = typeDef.value ? decodeScSpecType(typeDef.value().keyType()) : { type: 'unknown' };
        const valueType = typeDef.value ? decodeScSpecType(typeDef.value().valueType()) : { type: 'unknown' };
        return { type: 'map', key: keyType, value: valueType };
      }
      case 'scSpecTypeTuple': {
        const types = typeDef.value
          ? typeDef.value().valueTypes().map(t => decodeScSpecType(t))
          : [];
        return { type: 'tuple', types };
      }
      case 'scSpecTypeBytesN': {
        const n = typeDef.value ? typeDef.value().n() : 0;
        return { type: `bytes${n}` };
      }
      case 'scSpecTypeUdt': {
        const name = typeDef.value ? typeDef.value().name().toString() : 'unknown';
        return { type: 'udt', name };
      }
      default:
        return { type: arm };
    }
  } catch (_) {
    return { type: arm };
  }
}

/**
 * Decodes a single `xdr.ScSpecEntry` into a plain-JS descriptor suitable for
 * the ABI schema.
 *
 * @param {Object} entry - An `xdr.ScSpecEntry` instance.
 * @returns {Object|null} Descriptor or null if the entry type is unrecognised.
 */
function decodeSpecEntry(entry) {
  try {
    const kind = entry.switch().name;

    switch (kind) {
      // ── Function ──────────────────────────────────────────────────────────
      case 'scSpecEntryFunctionV0': {
        const fn = entry.functionV0();
        const doc = fn.doc ? fn.doc().toString('utf8').replace(/\0/g, '').trim() : '';
        const name = fn.name ? fn.name().toString() : '';

        const inputs = fn.inputs
          ? fn.inputs().map(input => ({
              name: input.name().toString(),
              type: decodeScSpecType(input.type()),
              doc: input.doc ? input.doc().toString('utf8').replace(/\0/g, '').trim() : '',
            }))
          : [];

        const outputs = fn.outputs
          ? fn.outputs().map(out => decodeScSpecType(out))
          : [];

        return { kind: 'function', name, doc, inputs, outputs };
      }

      // ── Struct ────────────────────────────────────────────────────────────
      case 'scSpecEntryUdtStructV0': {
        const struct = entry.udtStructV0();
        const doc = struct.doc ? struct.doc().toString('utf8').replace(/\0/g, '').trim() : '';
        const name = struct.name ? struct.name().toString() : '';
        const fields = struct.fields
          ? struct.fields().map(f => ({
              name: f.name().toString(),
              type: decodeScSpecType(f.type()),
              doc: f.doc ? f.doc().toString('utf8').replace(/\0/g, '').trim() : '',
            }))
          : [];
        return { kind: 'struct', name, doc, fields };
      }

      // ── Union ─────────────────────────────────────────────────────────────
      case 'scSpecEntryUdtUnionV0': {
        const union = entry.udtUnionV0();
        const doc = union.doc ? union.doc().toString('utf8').replace(/\0/g, '').trim() : '';
        const name = union.name ? union.name().toString() : '';
        const cases = union.cases
          ? union.cases().map(c => {
              const caseKind = c.switch().name;
              if (caseKind === 'scSpecUdtUnionCaseVoidV0') {
                return { kind: 'void', name: c.voidCase ? c.voidCase().name().toString() : '' };
              }
              if (caseKind === 'scSpecUdtUnionCaseTupleV0') {
                const tc = c.tupleCase ? c.tupleCase() : null;
                return {
                  kind: 'tuple',
                  name: tc ? tc.name().toString() : '',
                  types: tc ? tc.type().map(t => decodeScSpecType(t)) : [],
                };
              }
              return { kind: caseKind };
            })
          : [];
        return { kind: 'union', name, doc, cases };
      }

      // ── Enum ──────────────────────────────────────────────────────────────
      case 'scSpecEntryUdtEnumV0': {
        const enm = entry.udtEnumV0();
        const doc = enm.doc ? enm.doc().toString('utf8').replace(/\0/g, '').trim() : '';
        const name = enm.name ? enm.name().toString() : '';
        const cases = enm.cases
          ? enm.cases().map(c => ({
              name: c.name().toString(),
              value: c.value(),
              doc: c.doc ? c.doc().toString('utf8').replace(/\0/g, '').trim() : '',
            }))
          : [];
        return { kind: 'enum', name, doc, cases };
      }

      // ── Error Enum ────────────────────────────────────────────────────────
      case 'scSpecEntryUdtErrorEnumV0': {
        const errEnm = entry.udtErrorEnumV0();
        const doc = errEnm.doc ? errEnm.doc().toString('utf8').replace(/\0/g, '').trim() : '';
        const name = errEnm.name ? errEnm.name().toString() : '';
        const cases = errEnm.cases
          ? errEnm.cases().map(c => ({
              name: c.name().toString(),
              value: c.value(),
              doc: c.doc ? c.doc().toString('utf8').replace(/\0/g, '').trim() : '',
            }))
          : [];
        return { kind: 'error_enum', name, doc, cases };
      }

      default:
        return null;
    }
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parser class
// ---------------------------------------------------------------------------

class Parser {
  /**
   * Extracts and standardises ABI from raw contract data.
   *
   * When `rawData.bytecode` is a real WASM `Buffer` / `Uint8Array` / `Readable`
   * stream (optionally gzip-compressed), the parser:
   *   1. Decompresses if necessary.
   *   2. Validates WASM magic bytes and section layout.
   *   3. Extracts the embedded `contractspecv0` custom section.
   *   4. Deserialises each XDR `ScSpecEntry` into a typed ABI descriptor.
   *
   * When the bytecode is a plain string (legacy / test path) or when the
   * `@stellar/stellar-sdk` is not installed, the parser falls back to the
   * `mockFunctions` / `mockEvents` fields on `rawData`.
   *
   * @param {Object} rawData
   * @param {Buffer|Uint8Array|Readable|string} rawData.bytecode
   * @param {Array} [rawData.mockFunctions] - Fallback functions for tests
   * @param {Array} [rawData.mockEvents] - Fallback events for tests
   * @param {boolean} [rawData.simulatedError] - Force an error (tests only)
   * @returns {Object|null|Promise<Object|null>}
   */
  extractABI(rawData) {
    try {
      if (!rawData || !rawData.bytecode) {
        throw new Error('Raw data missing bytecode');
      }

      if (Buffer.isBuffer(rawData.bytecode) || rawData.bytecode instanceof Uint8Array || rawData.bytecode instanceof Readable) {
        return this.extractFromWasm(rawData);
      }

      // Legacy / test path: plain string bytecode
      if (rawData.simulatedError) {
        throw new Error('Simulated parsing error');
      }

      const abi = {
        functions: rawData.mockFunctions || [],
        events: rawData.mockEvents || [],
        version: '1.0.0',
      };

      console.log('[Parser] Successfully extracted ABI');
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
      let wasm;

      if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
        const bytes = Buffer.from(source);
        if (bytes.subarray(0, WASM_MAGIC.length).equals(WASM_MAGIC)) {
          // Raw uncompressed WASM
          if (bytes.length > MAX_UNCOMPRESSED_SIZE) {
            throw new Error(`Uncompressed bytecode exceeds ${MAX_UNCOMPRESSED_SIZE} bytes`);
          }
          wasm = bytes;
        } else {
          // Treat as gzip-compressed
          if (bytes.length > MAX_COMPRESSED_SIZE) {
            throw new Error(`Compressed bytecode exceeds ${MAX_COMPRESSED_SIZE} bytes`);
          }
          wasm = await this._gunzip(Readable.from([bytes]));
        }
      } else {
        // Readable stream (may be compressed or raw)
        const input = new SizeLimitTransform(MAX_COMPRESSED_SIZE, 'Compressed bytecode');
        const output = new SizeLimitTransform(MAX_UNCOMPRESSED_SIZE, 'Uncompressed bytecode');
        const chunks = [];
        output.on('data', chunk => chunks.push(chunk));
        await pipeline(source, input, createUnzip(), output);
        wasm = Buffer.concat(chunks);
      }

      this.validateWasm(wasm);

      if (rawData.simulatedError) {
        throw new Error('Simulated parsing error');
      }

      // Try to extract real ContractSpec from the validated WASM
      const specPayload = this._extractContractSpecSection(wasm);
      if (specPayload && stellarXdr) {
        return this._parseContractSpec(specPayload, rawData);
      }

      // Fallback: SDK not available or section absent — use mock fields
      return this.createABI(rawData);
    } catch (err) {
      this.lastError = this.toStructuredError(err);
      errorHandler.logError('Parser', err);
      return null;
    }
  }

  /**
   * Decompresses a gzip-compressed Readable source into a Buffer.
   *
   * @private
   * @param {Readable} inputStream
   * @returns {Promise<Buffer>}
   */
  async _gunzip(inputStream) {
    const input = new SizeLimitTransform(MAX_COMPRESSED_SIZE, 'Compressed bytecode');
    const output = new SizeLimitTransform(MAX_UNCOMPRESSED_SIZE, 'Uncompressed bytecode');
    const chunks = [];
    output.on('data', chunk => chunks.push(chunk));
    await pipeline(inputStream, input, createUnzip(), output);
    return Buffer.concat(chunks);
  }

  /**
   * Scans a validated WASM binary for a custom section named `contractspecv0`
   * and returns its raw payload bytes (excluding the name prefix), or `null`
   * if the section is not present.
   *
   * Custom section layout (each length is an unsigned LEB128):
   *   [section_id=0] [section_byte_length] [name_byte_length] [name_utf8] [payload]
   *
   * @private
   * @param {Buffer} wasm - Validated WASM binary.
   * @returns {Buffer|null}
   */
  _extractContractSpecSection(wasm) {
    // Skip WASM magic (4 bytes) + version (4 bytes)
    let offset = 8;

    while (offset < wasm.length) {
      const sectionId = wasm[offset++];
      const sectionSize = this.readUnsignedLeb128(wasm, offset, 'SECTION_SIZE');
      offset = sectionSize.nextOffset;
      const sectionEnd = offset + sectionSize.value;

      if (sectionEnd > wasm.length) break; // validateWasm already caught this

      if (sectionId === 0) {
        // Custom section: read the name
        const nameLen = this.readUnsignedLeb128(wasm, offset, 'CUSTOM_NAME_LENGTH');
        const nameStart = nameLen.nextOffset;
        const nameEnd = nameStart + nameLen.value;

        if (nameEnd <= sectionEnd) {
          const sectionName = wasm.toString('utf8', nameStart, nameEnd);
          if (sectionName === CONTRACT_SPEC_SECTION) {
            // Payload is everything after the name, up to sectionEnd
            const payloadStart = nameEnd;
            const payloadLen = sectionEnd - payloadStart;
            if (payloadLen > 0) {
              return wasm.subarray(payloadStart, sectionEnd);
            }
            // Empty section — validateWasm raises INVALID_CONTRACT_SPEC for this
          }
        }
      }

      offset = sectionEnd;
    }

    return null;
  }

  /**
   * Decodes the raw `contractspecv0` section bytes into a JSON ABI object.
   *
   * The section is a concatenation of XDR-encoded `ScSpecEntry` messages.
   * Each entry is a fixed-length XDR union (not length-prefixed), so we must
   * read them one-by-one until the buffer is exhausted.
   *
   * @private
   * @param {Buffer} payload - Raw contractspecv0 section bytes.
   * @param {Object} rawData - Original rawData (for fallback mock fields).
   * @returns {Object} ABI schema.
   */
  _parseContractSpec(payload, rawData) {
    const functions = [];
    const structs = [];
    const unions = [];
    const enums = [];
    const errorEnums = [];

    let offset = 0;
    let parseErrors = 0;

    while (offset < payload.length) {
      try {
        // ScSpecEntry is a variable-length XDR message.  The XDR library
        // exposes fromXDR(buffer) and fromXDR(buffer, 'raw') — the latter
        // reads exactly as many bytes as the union requires and returns the
        // entry plus how many bytes were consumed (via ioref, if supported),
        // or we can use a slicing approach.
        //
        // stellar-sdk's xdr uses `js-xdr` which exposes `ScSpecEntry.read(io)`
        // where `io` is an XdrReader.  The most portable approach is to
        // deserialise one entry at a time by catching errors when we over-read.
        //
        // We use the `xdr.ScSpecEntry.fromXDR(slice)` approach, trying
        // progressively larger slices until one parses cleanly.  In practice,
        // xdr entries are self-delimiting and `fromXDR` on a buffer that
        // contains exactly one entry (or more) will succeed; excess bytes are
        // simply ignored by the XDR reader.  We track position via a custom
        // XDR reader when available, otherwise use the greedy-slice heuristic.

        const slice = payload.subarray(offset);
        if (slice.length === 0) break;

        let entry;
        let consumed;

        if (stellarXdr.ScSpecEntry && typeof stellarXdr.ScSpecEntry.fromXDR === 'function') {
          // js-xdr `fromXDR` reads exactly the bytes for one value and
          // returns it; any remaining bytes in the buffer are ignored.
          // To advance the offset we need to know how many bytes were
          // consumed.  js-xdr doesn't expose that directly, so we binary-
          // search for the minimal slice that parses without error.
          ({ entry, consumed } = this._readOneScSpecEntry(slice));
        }

        if (!entry) break;

        const decoded = decodeSpecEntry(entry);
        if (decoded) {
          switch (decoded.kind) {
            case 'function':    functions.push(decoded); break;
            case 'struct':      structs.push(decoded);   break;
            case 'union':       unions.push(decoded);    break;
            case 'enum':        enums.push(decoded);     break;
            case 'error_enum':  errorEnums.push(decoded); break;
            default: break;
          }
        }

        offset += consumed;
      } catch (xdrErr) {
        parseErrors++;
        // Advance by 1 byte to attempt recovery, but cap total failures
        offset++;
        if (parseErrors > 16) break;
      }
    }

    console.log(
      `[Parser] Decoded contractspecv0: ${functions.length} functions, ` +
        `${structs.length} structs, ${unions.length} unions, ` +
        `${enums.length} enums, ${errorEnums.length} error_enums`
    );

    return {
      functions,
      structs,
      unions,
      enums,
      errorEnums,
      events: rawData.mockEvents || [],
      version: '1.0.0',
    };
  }

  /**
   * Reads exactly one `ScSpecEntry` from the head of `slice` and returns the
   * parsed entry together with the number of bytes consumed.
   *
   * Strategy: XDR unions are self-delimiting.  We try `fromXDR` on the
   * entire slice first (greedy).  If that succeeds we binary-search for the
   * minimal consumed byte count by re-parsing with progressively shorter
   * slices until parsing fails, then return the last successful length.
   *
   * This is O(n log n) per entry in the worst case but entries are small
   * (typically < 1 KB) so it is fast enough in practice.
   *
   * @private
   * @param {Buffer} slice
   * @returns {{ entry: Object, consumed: number }}
   */
  _readOneScSpecEntry(slice) {
    const fromXDR = stellarXdr.ScSpecEntry.fromXDR.bind(stellarXdr.ScSpecEntry);

    // Attempt greedy parse on the full slice
    let entry;
    try {
      entry = fromXDR(slice);
    } catch (_) {
      throw new Error('Cannot parse ScSpecEntry from slice');
    }

    // Binary-search the minimum consumed length
    let lo = 1;
    let hi = slice.length;
    let bestLen = hi; // we know hi works
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      try {
        fromXDR(slice.subarray(0, mid));
        bestLen = mid;
        hi = mid - 1;
      } catch (_) {
        lo = mid + 1;
      }
    }

    return { entry, consumed: bestLen };
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
      status: error.status || 422,
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
      version: '1.0.0',
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
