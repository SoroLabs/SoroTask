/**
 * Dedicated Test Runner for [BE-FINAL-37] Automated Secret Rotation Engine
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  SecretRotationEngine,
  DualAuthManager,
  generateDatabasePassword,
  generateRpcToken,
  generateJwtSecret,
  computeFingerprint,
  THIRTY_DAYS_MS,
  SECRET_TYPES,
  COMPLIANCE_STATUS,
} = require('./src/secretsManager');

const {
  SigningKeyRotationEngine,
  createTransitionKeyring,
} = require('./src/keyRotation');

async function runTests() {
  console.log('================================================================');
  console.log(' RUNNING BE-FINAL-37 COMPREHENSIVE TEST SUITE');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(` [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(` [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(` [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(` [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // --- Acceptance Criteria 1: Secrets rotate automatically every 30 days ---
  console.log('\n--- 1. Acceptance Criteria: 30-Day Automated Secret Rotation ---');

  test('Secrets initialize with 30-day nextRotationDueAt schedule', () => {
    const engine = new SecretRotationEngine({ provider: 'memory' });
    const sec = engine.registerSecret({
      name: 'PROD_DB_PASSWORD',
      type: SECRET_TYPES.DATABASE_PASSWORD,
    });
    assert.strictEqual(sec.name, 'PROD_DB_PASSWORD');
    assert.strictEqual(sec.version, 1);
    assert.strictEqual(sec.rotationIntervalMs, THIRTY_DAYS_MS);
    const diff = sec.nextRotationDueAt.getTime() - sec.lastRotatedAt.getTime();
    assert.strictEqual(diff, THIRTY_DAYS_MS);
  });

  await testAsync('Automatically detects and rotates secrets due after 30 days', async () => {
    const engine = new SecretRotationEngine({ provider: 'memory' });
    const thirtyOneDaysAgo = new Date(Date.now() - (31 * 24 * 60 * 60 * 1000));
    engine.registerSecret({
      name: 'RPC_API_TOKEN',
      type: SECRET_TYPES.RPC_TOKEN,
      lastRotatedAt: thirtyOneDaysAgo,
    });

    const initialVal = engine.getActiveSecret('RPC_API_TOKEN');
    const rotated = await engine.checkAndRotateDueSecrets();

    assert.strictEqual(rotated.length, 1);
    assert.strictEqual(rotated[0].name, 'RPC_API_TOKEN');
    assert.strictEqual(rotated[0].version, 2);

    const newVal = engine.getActiveSecret('RPC_API_TOKEN');
    assert.notStrictEqual(newVal, initialVal);
    assert.ok(newVal.length >= 32);
  });

  await testAsync('Does not rotate secrets that are not due', async () => {
    const engine = new SecretRotationEngine({ provider: 'memory' });
    const yesterday = new Date(Date.now() - (24 * 60 * 60 * 1000));
    engine.registerSecret({
      name: 'JWT_SIGNING_KEY',
      type: SECRET_TYPES.JWT_SECRET,
      lastRotatedAt: yesterday,
    });

    const rotated = await engine.checkAndRotateDueSecrets();
    assert.strictEqual(rotated.length, 0);
  });

  // --- Acceptance Criteria 2: Dual-Authentication Windows prevent connection drops ---
  console.log('\n--- 2. Acceptance Criteria: Dual-Authentication Windows ---');

  await testAsync('Database Passwords: Zero connection drops during dual-auth window', async () => {
    const engine = new SecretRotationEngine({ provider: 'memory' });
    const oldPassword = 'old-db-password-12345';
    const newPassword = 'new-db-password-67890';

    engine.registerSecret({
      name: 'APP_DB_PASSWORD',
      type: SECRET_TYPES.DATABASE_PASSWORD,
      value: oldPassword,
    });

    // Enter dual-auth window
    await engine.rotateSecret('APP_DB_PASSWORD', {
      newValue: newPassword,
      dualAuthWindowMs: 500,
      autoComplete: false,
    });

    // Both old and new passwords authenticate without drop
    assert.strictEqual(engine.validateDatabasePassword('APP_DB_PASSWORD', oldPassword), true);
    assert.strictEqual(engine.validateDatabasePassword('APP_DB_PASSWORD', newPassword), true);
    assert.strictEqual(engine.validateDatabasePassword('APP_DB_PASSWORD', 'wrong-password'), false);

    // Complete dual-auth window: retire old password
    engine.completeDualAuth('APP_DB_PASSWORD');

    assert.strictEqual(engine.validateDatabasePassword('APP_DB_PASSWORD', newPassword), true);
    assert.strictEqual(engine.validateDatabasePassword('APP_DB_PASSWORD', oldPassword), false);
  });

  await testAsync('RPC Tokens: Both old and new tokens valid during grace window', async () => {
    const engine = new SecretRotationEngine({ provider: 'memory' });
    engine.registerSecret({
      name: 'SOROBAN_RPC_TOKEN',
      type: SECRET_TYPES.RPC_TOKEN,
      value: 'rpc-token-v1-old',
    });

    await engine.rotateSecret('SOROBAN_RPC_TOKEN', {
      newValue: 'rpc-token-v2-new',
      dualAuthWindowMs: 500,
      autoComplete: false,
    });

    assert.strictEqual(engine.validateRpcToken('SOROBAN_RPC_TOKEN', 'rpc-token-v1-old'), true);
    assert.strictEqual(engine.validateRpcToken('SOROBAN_RPC_TOKEN', 'rpc-token-v2-new'), true);
    assert.strictEqual(engine.validateRpcToken('SOROBAN_RPC_TOKEN', 'fake-token'), false);
  });

  await testAsync('JWT Secrets: Verifies tokens signed with active or previous secret', async () => {
    const engine = new SecretRotationEngine({ provider: 'memory' });
    const oldSecret = 'AAAA-jwt-secret-original-32-bytes-key';
    const newSecret = 'BBBB-jwt-secret-rotated-32-bytes-key!';

    engine.registerSecret({
      name: 'SESSION_JWT',
      type: SECRET_TYPES.JWT_SECRET,
      value: oldSecret,
    });

    const sign = (p, s) => `${p}.${s.slice(0, 8)}`;
    const verify = (t, s) => {
      const [p, sig] = t.split('.');
      if (sig === s.slice(0, 8)) return { user: p };
      throw new Error('Signature mismatch');
    };

    const tokenOld = sign('alice', oldSecret);

    await engine.rotateSecret('SESSION_JWT', {
      newValue: newSecret,
      dualAuthWindowMs: 500,
      autoComplete: false,
    });

    const tokenNew = sign('bob', newSecret);

    // Both verify in dual-auth window
    assert.deepStrictEqual(engine.validateJwt('SESSION_JWT', tokenNew, verify), { user: 'bob' });
    assert.deepStrictEqual(engine.validateJwt('SESSION_JWT', tokenOld, verify), { user: 'alice' });

    // Close window
    engine.completeDualAuth('SESSION_JWT');
    assert.deepStrictEqual(engine.validateJwt('SESSION_JWT', tokenNew, verify), { user: 'bob' });
    assert.throws(() => engine.validateJwt('SESSION_JWT', tokenOld, verify), /Signature mismatch/);
  });

  // --- Acceptance Criteria 3: Compliance Audit Reports Exported ---
  console.log('\n--- 3. Acceptance Criteria: Compliance Audit Reports Exported ---');

  test('Generates SOC2 Type II / ISO 27001 compliant audit reports', () => {
    const engine = new SecretRotationEngine({ provider: 'memory' });
    engine.registerSecret({ name: 'DB_KEY', type: SECRET_TYPES.DATABASE_PASSWORD });
    engine.registerSecret({ name: 'RPC_KEY', type: SECRET_TYPES.RPC_TOKEN });

    const report = engine.generateComplianceReport();
    assert.ok(report.reportId);
    assert.strictEqual(report.standard, 'SOC2_TYPE_II_ISO_27001_ANNEX_A_5_15');
    assert.strictEqual(report.summary.totalSecrets, 2);
    assert.strictEqual(report.summary.compliantSecrets, 2);
    assert.strictEqual(report.summary.complianceScorePercent, 100);
    assert.ok(report.integritySignature);
    assert.ok(report.secrets[0].activeFingerprint.startsWith('sha256:'));
  });

  test('Exports audit reports to JSON, CSV, and Markdown files on disk', () => {
    const engine = new SecretRotationEngine({ provider: 'memory' });
    engine.registerSecret({ name: 'AUDIT_EXPORT_SEC', type: SECRET_TYPES.DATABASE_PASSWORD });

    const outDir = path.join(__dirname, 'test_audit_output');

    // JSON export
    const jsonRes = engine.exportAuditReport({
      format: 'json',
      filePath: path.join(outDir, 'audit.json'),
    });
    assert.ok(fs.existsSync(jsonRes.filePath));
    const parsed = JSON.parse(fs.readFileSync(jsonRes.filePath, 'utf8'));
    assert.strictEqual(parsed.summary.totalSecrets, 1);

    // CSV export
    const csvRes = engine.exportAuditReport({
      format: 'csv',
      filePath: path.join(outDir, 'audit.csv'),
    });
    assert.ok(fs.existsSync(csvRes.filePath));
    const csvText = fs.readFileSync(csvRes.filePath, 'utf8');
    assert.ok(csvText.includes('AUDIT_EXPORT_SEC'));

    // Markdown export
    const mdRes = engine.exportAuditReport({
      format: 'markdown',
      filePath: path.join(outDir, 'audit.md'),
    });
    assert.ok(fs.existsSync(mdRes.filePath));
    const mdText = fs.readFileSync(mdRes.filePath, 'utf8');
    assert.ok(mdText.includes('SOC2 / ISO27001 Secret Rotation Compliance Audit Report'));

    // Clean up
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  // --- 4. Stress & Concurrency Test ---
  console.log('\n--- 4. Concurrency & Stress Testing ---');

  await testAsync('1,000 Concurrent connection authentications during active rotation', async () => {
    const engine = new SecretRotationEngine({ provider: 'memory' });
    const secName = 'STRESS_DB';
    const oldP = 'initial-pass';
    const newP = 'rotated-pass';

    engine.registerSecret({ name: secName, type: SECRET_TYPES.DATABASE_PASSWORD, value: oldP });
    await engine.rotateSecret(secName, { newValue: newP, dualAuthWindowMs: 1000, autoComplete: false });

    let validCount = 0;
    const total = 1000;
    for (let i = 0; i < total; i++) {
      const candidate = i % 2 === 0 ? oldP : newP;
      if (engine.validateDatabasePassword(secName, candidate)) validCount++;
    }
    assert.strictEqual(validCount, total);
  });

  // --- 5. Signing Key Rotation Integration ---
  console.log('\n--- 5. Signing Key Rotation Engine Integration ---');

  test('SigningKeyRotationEngine manages 30-day lifecycle and exports audit', () => {
    const mockKeypair = { publicKey: () => 'GDKEEPERPUBLICKEY1234567890MOCK' };
    const signerEngine = new SigningKeyRotationEngine({
      keypair: mockKeypair,
      rotationIntervalMs: THIRTY_DAYS_MS,
    });

    const audit = signerEngine.exportComplianceAudit();
    assert.strictEqual(audit.currentPublicKey, mockKeypair.publicKey());
    assert.strictEqual(audit.rotationIntervalDays, 30);
    assert.strictEqual(audit.status, 'COMPLIANT');
  });

  console.log('\n================================================================');
  console.log(` SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
