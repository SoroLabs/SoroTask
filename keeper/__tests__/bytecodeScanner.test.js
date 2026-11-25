'use strict';

const { BytecodeScanner, WASM_MAGIC, WASM_VERSION } = require('../src/bytecodeScanner');
const { validateTaskPayload, validateContractBytecode } = require('../src/taskValidator');
const TaskPoller = require('../src/poller');

function createSimpleWasm(instructions = []) {
  // Minimal valid WASM with a single function containing specified instructions
  // Type section (1): 1 function () -> ()
  const typeSection = Buffer.from([0x01, 0x04, 0x01, 0x60, 0x00, 0x00]);
  // Function section (3): 1 function of type 0
  const funcSection = Buffer.from([0x03, 0x02, 0x01, 0x00]);
  // Code section (10)
  const bodyInstructions = Buffer.from(instructions);
  // local decl count (0) + instructions + end (0x0b)
  const funcBody = Buffer.concat([Buffer.from([0x00]), bodyInstructions, Buffer.from([0x0b])]);
  const codeSection = Buffer.concat([
    Buffer.from([0x0a, funcBody.length + 2, 0x01, funcBody.length]),
    funcBody,
  ]);

  return Buffer.concat([WASM_MAGIC, WASM_VERSION, typeSection, funcSection, codeSection]);
}

describe('[BE-PROD-23] Automated Smart Contract Bytecode Vulnerability Scanner (#1447)', () => {
  let scanner;

  beforeEach(() => {
    scanner = new BytecodeScanner();
  });

  test('completes bytecode analysis in < 15ms per new contract', () => {
    const validWasm = createSimpleWasm([0x01, 0x01]); // nops
    const result = scanner.scan(validWasm);

    expect(result.durationMs).toBeLessThan(15);
    expect(result.safe).toBe(true);
    expect(result.vulnerabilities).toHaveLength(0);
  });

  test('disassembles WASM instructions to AST', () => {
    const wasm = createSimpleWasm([0x01, 0x0f]); // nop, return
    const result = scanner.scan(wasm);

    expect(result.ast).not.toBeNull();
    expect(result.ast.functions).toHaveLength(1);
    expect(result.ast.functions[0].instructions.some((inst) => inst.name === 'return')).toBe(true);
  });

  test('detects infinite simulation loops with unconditional backward branches', () => {
    // loop (0x03 0x40) -> br 0 (0x0c 0x00) -> end (0x0b)
    const infiniteLoopWasm = createSimpleWasm([0x03, 0x40, 0x0c, 0x00, 0x0b]);
    const result = scanner.scan(infiniteLoopWasm, {
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });

    expect(result.safe).toBe(false);
    expect(result.vulnerabilities.some((v) => v.includes('infinite_simulation_loop'))).toBe(true);
    expect(scanner.isBlacklisted('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
  });

  test('allows loops with conditional exits (zero false positives on standard contracts)', () => {
    // loop (0x03 0x40) -> br_if 0 (0x0d 0x00) -> end (0x0b)
    const safeLoopWasm = createSimpleWasm([0x03, 0x40, 0x0d, 0x00, 0x0b]);
    const result = scanner.scan(safeLoopWasm);

    expect(result.safe).toBe(true);
    expect(result.vulnerabilities).toHaveLength(0);
  });

  test('detects unbounded memory growth inside loops', () => {
    // loop (0x03 0x40) -> memory.grow (0x40 0x00) -> br_if 0 (0x0d 0x00) -> end (0x0b)
    const memGrowLoopWasm = createSimpleWasm([0x03, 0x40, 0x40, 0x00, 0x0d, 0x00, 0x0b]);
    const result = scanner.scan(memGrowLoopWasm);

    expect(result.safe).toBe(false);
    expect(result.vulnerabilities.some((v) => v.includes('unbounded_storage_growth'))).toBe(true);
  });

  test('detects reentrancy vectors with call_indirect preceding state mutation', () => {
    // call_indirect (0x11 0x00 0x00) -> memory store (0x36 0x00 0x00)
    const reentrantWasm = createSimpleWasm([0x11, 0x00, 0x00, 0x36, 0x00, 0x00]);
    const result = scanner.scan(reentrantWasm);

    expect(result.safe).toBe(false);
    expect(result.vulnerabilities.some((v) => v.includes('unbounded_reentrancy_vector'))).toBe(true);
  });

  test('validates contract bytecode via helper function', () => {
    const validWasm = createSimpleWasm([0x01]);
    const validation = validateContractBytecode(validWasm);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  test('validates payload and rejects blacklisted target contract', () => {
    const maliciousTarget = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    scanner.blacklistContract(maliciousTarget, 'infinite_loop_detected');

    const validPayload = {
      target: maliciousTarget,
      function: 'execute_trade',
    };

    const validation = validateTaskPayload(validPayload, [], { scanner });
    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain('blacklisted');
  });

  test('integrates with TaskPoller pre-poll pipeline', async () => {
    const mockServer = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000, closeTime: 1000 }),
      simulateTransaction: jest.fn(),
      getAccount: jest.fn(),
    };

    const poller = new TaskPoller(mockServer, 'C123', {
      bytecodeScanner: scanner,
    });

    const maliciousTarget = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    scanner.blacklistContract(maliciousTarget);

    const taskConfig = {
      last_run: 500,
      interval: 100,
      gas_balance: 5000,
      target: maliciousTarget,
      function: 'run',
      args: [],
    };

    const check = await poller.checkTask(1, 1000, null, {
      preloadedConfig: taskConfig,
    });

    expect(check.isDue).toBe(false);
    expect(check.reason).toBe('contract_blacklisted');
  });
});
