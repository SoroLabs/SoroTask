'use strict';

const { extractDeclaredSignals, extractConstrainedSignals } = require('./circom-fuzzer');

describe('circom-fuzzer static signal analysis', () => {
  it('flags a declared signal that never appears in a constraint', () => {
    const source = `
      template Vulnerable() {
        signal input a;
        signal input b;
        signal output c;
        signal unused;

        c <== a * b;
      }
    `;
    const declared = extractDeclaredSignals(source);
    const constrained = extractConstrainedSignals(source);
    const underConstrained = declared.filter((sig) => !constrained.has(sig));

    expect(declared).toEqual(expect.arrayContaining(['a', 'b', 'c', 'unused']));
    expect(underConstrained).toEqual(['unused']);
  });

  it('reports no under-constrained signals for a fully-constrained circuit', () => {
    const source = `
      template SafeMultiplier() {
        signal input a;
        signal input b;
        signal output c;

        c <== a * b;
      }
    `;
    const declared = extractDeclaredSignals(source);
    const constrained = extractConstrainedSignals(source);
    const underConstrained = declared.filter((sig) => !constrained.has(sig));

    expect(underConstrained).toEqual([]);
  });
});

describe('automated circuit constraint verification', () => {
  it('runs automated circuit constraint verification during test execution on all circuits', async () => {
    const { auditCircuits } = require('./circom-fuzzer');
    const fs = require('fs');
    const path = require('path');
    
    const circuitsDir = path.join(__dirname, '../circuits');
    const circuitFiles = fs.readdirSync(circuitsDir)
      .filter((f) => f.endsWith('.circom'))
      .map((f) => path.join(circuitsDir, f));
      
    // Skip if there are no circuits, otherwise expect auditCircuits to pass without throwing
    if (circuitFiles.length > 0) {
      await expect(
        auditCircuits(circuitFiles.map((file) => ({ file, fuzzRounds: 5 })))
      ).resolves.toBeDefined();
    }
  }, 60000); // Allow longer timeout for circuit verification
});
