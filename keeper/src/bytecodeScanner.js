'use strict';

const crypto = require('crypto');
const { createLogger } = require('./logger');

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const WASM_VERSION = Buffer.from([0x01, 0x00, 0x00, 0x00]);

const SECTION_IMPORT = 2;
const SECTION_MEMORY = 5;
const SECTION_CODE = 10;

// Maximum allowed initial or maximum memory in 64KB pages for Soroban contracts (32 MB)
const MAX_SAFE_PAGES = 512;

class BytecodeScanner {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('bytecode-scanner');
    this.blacklist = new Set(options.initialBlacklist || []);
    this.cache = new Map();
    this.maxCacheSize = options.maxCacheSize || 2000;
  }

  isBlacklisted(contractId) {
    if (!contractId) return false;
    return this.blacklist.has(String(contractId));
  }

  blacklistContract(contractId, reason = 'vulnerable_bytecode') {
    if (!contractId) return;
    const id = String(contractId);
    this.blacklist.add(id);
    this.logger.warn('Contract blacklisted by bytecode security scanner', {
      contractId: id,
      reason,
    });
  }

  unblacklistContract(contractId) {
    if (!contractId) return;
    this.blacklist.delete(String(contractId));
  }

  getBlacklist() {
    return Array.from(this.blacklist);
  }

  /**
   * Scans WASM bytecode for infinite loops, unbounded storage growth, and reentrancy vectors.
   * Completes in < 15ms per new contract.
   *
   * @param {Buffer|Uint8Array} bytecode - WASM binary
   * @param {Object} [options]
   * @param {string} [options.contractId] - Target contract ID for auto-blacklisting
   * @returns {{ safe: boolean, vulnerabilities: string[], ast: Object, durationMs: number }}
   */
  scan(bytecode, options = {}) {
    const startTime = process.hrtime.bigint();
    const contractId = options.contractId || null;

    if (!bytecode || !Buffer.isBuffer(bytecode) && !(bytecode instanceof Uint8Array)) {
      return {
        safe: false,
        vulnerabilities: ['invalid_or_missing_bytecode'],
        ast: null,
        durationMs: 0,
      };
    }

    const buf = Buffer.isBuffer(bytecode) ? bytecode : Buffer.from(bytecode);

    // Hash cache lookup
    const bytecodeHash = crypto.createHash('sha256').update(buf).digest('hex');
    if (this.cache.has(bytecodeHash)) {
      const cached = this.cache.get(bytecodeHash);
      if (!cached.safe && contractId) {
        this.blacklistContract(contractId, cached.vulnerabilities.join(', '));
      }
      return {
        ...cached,
        cached: true,
        durationMs: 0.1,
      };
    }

    const vulnerabilities = [];

    // 1. Magic number & version check
    if (buf.length < 8) {
      vulnerabilities.push('corrupt_binary_too_short');
    } else if (!buf.subarray(0, 4).equals(WASM_MAGIC)) {
      vulnerabilities.push('invalid_wasm_magic_header');
    } else if (!buf.subarray(4, 8).equals(WASM_VERSION)) {
      vulnerabilities.push('unsupported_wasm_version');
    }

    if (vulnerabilities.length > 0) {
      if (contractId) this.blacklistContract(contractId, vulnerabilities[0]);
      return {
        safe: false,
        vulnerabilities,
        ast: null,
        durationMs: Number(process.hrtime.bigint() - startTime) / 1e6,
      };
    }

    // 2. Disassemble WASM sections to AST
    const { sections, ast, error } = this.disassembleSections(buf);
    if (error) {
      vulnerabilities.push(`disassembly_error: ${error}`);
      if (contractId) this.blacklistContract(contractId, vulnerabilities[0]);
      return {
        safe: false,
        vulnerabilities,
        ast: null,
        durationMs: Number(process.hrtime.bigint() - startTime) / 1e6,
      };
    }

    // 3. Static Analysis Rules
    this.checkMemoryBounds(sections, vulnerabilities);
    this.checkCodeVulnerabilities(ast, vulnerabilities);

    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
    const safe = vulnerabilities.length === 0;

    const result = {
      safe,
      vulnerabilities,
      ast,
      durationMs: Math.round(durationMs * 100) / 100,
    };

    // Bound cache size
    if (this.cache.size >= this.maxCacheSize) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
    this.cache.set(bytecodeHash, result);

    if (!safe && contractId) {
      this.blacklistContract(contractId, vulnerabilities.join('; '));
    }

    return result;
  }

  disassembleSections(buf) {
    let offset = 8;
    const sections = [];
    const ast = { functions: [], totalInstructions: 0, imports: [], exports: [] };

    try {
      while (offset < buf.length) {
        if (offset + 1 > buf.length) break;
        const sectionId = buf[offset++];
        const { value: sectionLen, bytesRead: lenBytes } = this.readVarUint(buf, offset);
        offset += lenBytes;

        if (offset + sectionLen > buf.length) {
          return { sections, ast, error: 'section_length_overflow' };
        }

        const sectionData = buf.subarray(offset, offset + sectionLen);
        sections.push({ id: sectionId, length: sectionLen, data: sectionData });

        if (sectionId === SECTION_CODE) {
          this.parseCodeSection(sectionData, ast);
        } else if (sectionId === SECTION_IMPORT) {
          this.parseImportSection(sectionData, ast);
        }

        offset += sectionLen;
      }
      return { sections, ast, error: null };
    } catch (err) {
      return { sections, ast, error: err.message };
    }
  }

  readVarUint(buf, offset) {
    let result = 0;
    let shift = 0;
    let bytesRead = 0;
    while (offset + bytesRead < buf.length) {
      const byte = buf[offset + bytesRead];
      bytesRead++;
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift >= 35) throw new Error('varuint_overflow');
    }
    return { value: result, bytesRead };
  }

  parseImportSection(data, ast) {
    try {
      let offset = 0;
      const { value: count, bytesRead } = this.readVarUint(data, offset);
      offset += bytesRead;
      for (let i = 0; i < count; i++) {
        if (offset >= data.length) break;
        const modLen = this.readVarUint(data, offset);
        offset += modLen.bytesRead;
        const modName = data.toString('utf8', offset, offset + modLen.value);
        offset += modLen.value;

        const fieldLen = this.readVarUint(data, offset);
        offset += fieldLen.bytesRead;
        const fieldName = data.toString('utf8', offset, offset + fieldLen.value);
        offset += fieldLen.value;

        if (offset >= data.length) break;
        const kind = data[offset++];
        ast.imports.push({ module: modName, field: fieldName, kind });
        if (kind === 0) { // func
          const typeIdx = this.readVarUint(data, offset);
          offset += typeIdx.bytesRead;
        } else if (kind === 1) { // table
          offset += 2;
        } else if (kind === 2) { // mem
          offset += 1;
        } else if (kind === 3) { // global
          offset += 2;
        }
      }
    } catch (_e) {
      // Best effort import parsing
    }
  }

  parseCodeSection(data, ast) {
    let offset = 0;
    const { value: count, bytesRead } = this.readVarUint(data, offset);
    offset += bytesRead;

    for (let f = 0; f < count && offset < data.length; f++) {
      const funcBodyLen = this.readVarUint(data, offset);
      offset += funcBodyLen.bytesRead;
      const bodyEnd = offset + funcBodyLen.value;
      const body = data.subarray(offset, Math.min(bodyEnd, data.length));
      offset = bodyEnd;

      const instructions = this.disassembleInstructions(body);
      ast.functions.push({
        index: f,
        instructions,
      });
      ast.totalInstructions += instructions.length;
    }
  }

  disassembleInstructions(body) {
    const instructions = [];
    let p = 0;
    // Skip locals declarations
    try {
      const { value: localCount, bytesRead } = this.readVarUint(body, p);
      p += bytesRead;
      for (let l = 0; l < localCount && p < body.length; l++) {
        const entryCount = this.readVarUint(body, p);
        p += entryCount.bytesRead;
        p += 1; // local type
      }
    } catch (_e) {
      p = 0;
    }

    while (p < body.length) {
      const opcode = body[p++];
      if (opcode === 0x0b) {
        instructions.push({ opcode, name: 'end' });
        break;
      }

      if (opcode === 0x03) {
        instructions.push({ opcode, name: 'loop' });
        p++; // blocktype
      } else if (opcode === 0x02) {
        instructions.push({ opcode, name: 'block' });
        p++; // blocktype
      } else if (opcode === 0x04) {
        instructions.push({ opcode, name: 'if' });
        p++; // blocktype
      } else if (opcode === 0x05) {
        instructions.push({ opcode, name: 'else' });
      } else if (opcode === 0x0c) {
        const depth = this.readVarUint(body, p);
        p += depth.bytesRead;
        instructions.push({ opcode, name: 'br', depth: depth.value });
      } else if (opcode === 0x0d) {
        const depth = this.readVarUint(body, p);
        p += depth.bytesRead;
        instructions.push({ opcode, name: 'br_if', depth: depth.value });
      } else if (opcode === 0x0e) {
        // br_table
        instructions.push({ opcode, name: 'br_table' });
        const targetCount = this.readVarUint(body, p);
        p += targetCount.bytesRead;
        for (let t = 0; t <= targetCount.value && p < body.length; t++) {
          const tgt = this.readVarUint(body, p);
          p += tgt.bytesRead;
        }
      } else if (opcode === 0x0f) {
        instructions.push({ opcode, name: 'return' });
      } else if (opcode === 0x10) {
        const funcIdx = this.readVarUint(body, p);
        p += funcIdx.bytesRead;
        instructions.push({ opcode, name: 'call', funcIndex: funcIdx.value });
      } else if (opcode === 0x11) {
        const typeIdx = this.readVarUint(body, p);
        p += typeIdx.bytesRead;
        p++; // table index (0x00)
        instructions.push({ opcode, name: 'call_indirect', typeIndex: typeIdx.value });
      } else if (opcode === 0x40) {
        p++; // reserved 0x00
        instructions.push({ opcode, name: 'memory.grow' });
      } else if (opcode === 0x3f) {
        p++; // reserved 0x00
        instructions.push({ opcode, name: 'memory.size' });
      } else if (opcode >= 0x20 && opcode <= 0x24) {
        const varIdx = this.readVarUint(body, p);
        p += varIdx.bytesRead;
        instructions.push({ opcode, name: 'variable_op', index: varIdx.value });
      } else if (opcode >= 0x28 && opcode <= 0x3e) {
        // memory load/store with align and offset
        const align = this.readVarUint(body, p);
        p += align.bytesRead;
        const offsetVal = this.readVarUint(body, p);
        p += offsetVal.bytesRead;
        instructions.push({ opcode, name: 'memory_io', offset: offsetVal.value });
      } else if (opcode === 0x41 || opcode === 0x42) {
        // i32 / i64 const
        const val = this.readVarUint(body, p);
        p += val.bytesRead;
        instructions.push({ opcode, name: 'const' });
      } else {
        instructions.push({ opcode, name: `op_0x${opcode.toString(16)}` });
      }
    }
    return instructions;
  }

  checkMemoryBounds(sections, vulnerabilities) {
    const memSection = sections.find((s) => s.id === SECTION_MEMORY);
    if (!memSection) return;

    try {
      const data = memSection.data;
      let offset = 0;
      const { value: count, bytesRead } = this.readVarUint(data, offset);
      offset += bytesRead;

      for (let i = 0; i < count; i++) {
        if (offset >= data.length) break;
        const flags = data[offset++];
        const initial = this.readVarUint(data, offset);
        offset += initial.bytesRead;

        if (initial.value > MAX_SAFE_PAGES) {
          vulnerabilities.push(`excessive_initial_memory: ${initial.value} pages exceeds limit of ${MAX_SAFE_PAGES}`);
        }

        if (flags & 0x01) {
          const maxPages = this.readVarUint(data, offset);
          offset += maxPages.bytesRead;
          if (maxPages.value > MAX_SAFE_PAGES) {
            vulnerabilities.push(`excessive_maximum_memory: ${maxPages.value} pages exceeds limit of ${MAX_SAFE_PAGES}`);
          }
        }
      }
    } catch (_e) {
      // Memory check fallback
    }
  }

  checkCodeVulnerabilities(ast, vulnerabilities) {
    for (const fn of ast.functions) {
      const instructions = fn.instructions;
      let inLoop = false;
      let loopInstructions = [];
      let loopDepth = 0;

      for (let i = 0; i < instructions.length; i++) {
        const inst = instructions[i];

        if (inst.name === 'loop') {
          inLoop = true;
          loopDepth++;
          loopInstructions = [];
        } else if (inst.name === 'end' && inLoop) {
          loopDepth--;
          if (loopDepth === 0) {
            inLoop = false;
            this.analyzeLoopBody(loopInstructions, vulnerabilities);
          }
        } else if (inLoop) {
          loopInstructions.push(inst);
        }

        // Reentrancy vector check:
        // call_indirect without reentrancy guard or external invocation before state writes
        if (inst.name === 'call_indirect') {
          // Check if followed by state mutations or external contract dispatch without guards
          const subsequentIo = instructions.slice(i + 1, i + 5).some(
            (sub) => sub.name === 'memory_io' || sub.name === 'variable_op'
          );
          if (subsequentIo) {
            vulnerabilities.push('unbounded_reentrancy_vector: call_indirect preceding unchecked state mutation');
          }
        }
      }
    }
  }

  analyzeLoopBody(loopInstructions, vulnerabilities) {
    const hasBackwardBr = loopInstructions.some((inst) => inst.name === 'br' && inst.depth === 0);
    const hasConditionalExit = loopInstructions.some(
      (inst) => inst.name === 'br_if' || inst.name === 'br_table' || inst.name === 'return'
    );

    // Rule 1: Infinite loop without exit condition
    if (hasBackwardBr && !hasConditionalExit) {
      vulnerabilities.push('infinite_simulation_loop: unconditional backward branch with no exit condition');
    }

    // Rule 2: Unbounded memory growth in loop
    const hasMemoryGrow = loopInstructions.some((inst) => inst.name === 'memory.grow');
    if (hasMemoryGrow) {
      vulnerabilities.push('unbounded_storage_growth: memory.grow dynamically executed inside loop');
    }
  }
}

module.exports = {
  BytecodeScanner,
  WASM_MAGIC,
  WASM_VERSION,
};
