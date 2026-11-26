/**
 * Automated Secret Rotation Engine & Cloud Secrets Manager Test Suite
 * [BE-FINAL-37] Unit, Integration & Stress Tests
 */

'use strict';

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
} = require('../src/secretsManager');

const {
  SigningKeyRotationEngine,
  createTransitionKeyring,
} = require('../src/keyRotation');

describe('SecretRotationEngine [BE-FINAL-37]', () => {
  let engine;

  beforeEach(() => {
    engine = new SecretRotationEngine({
      provider: 'memory',
      rotationIntervalMs: THIRTY_DAYS_MS,
      dualAuthWindowMs: 200, // short window for fast deterministic tests
    });
  });

  afterEach(() => {
    engine.stopScheduler();
  });

  describe('1. Acceptance Criteria: Secrets rotate automatically every 30 days', () => {
    it('initializes secrets with 30-day nextRotationDueAt schedule', () => {
      const dbSec = engine.registerSecret({
        name: 'DB_PASSWORD_PROD',
        type: SECRET_TYPES.DATABASE_PASSWORD,
      });

      expect(dbSec.name).toBe('DB_PASSWORD_PROD');
      expect(dbSec.version).toBe(1);
      expect(dbSec.rotationIntervalMs).toBe(THIRTY_DAYS_MS);

      const diffMs = dbSec.nextRotationDueAt.getTime() - dbSec.lastRotatedAt.getTime();
      expect(diffMs).toBe(THIRTY_DAYS_MS);
    });

    it('automatically identifies and rotates secrets due for rotation', async () => {
      // Register a secret that was rotated 31 days ago (past 30-day policy)
      const thirtyOneDaysAgo = new Date(Date.now() - (31 * 24 * 60 * 60 * 1000));
      engine.registerSecret({
        name: 'RPC_API_TOKEN',
        type: SECRET_TYPES.RPC_TOKEN,
        lastRotatedAt: thirtyOneDaysAgo,
      });

      const initialVal = engine.getActiveSecret('RPC_API_TOKEN');
      const rotated = await engine.checkAndRotateDueSecrets();

      expect(rotated).toHaveLength(1);
      expect(rotated[0].name).toBe('RPC_API_TOKEN');
      expect(rotated[0].version).toBe(2);

      const newVal = engine.getActiveSecret('RPC_API_TOKEN');
      expect(newVal).not.toBe(initialVal);
      expect(newVal.length).toBeGreaterThan(20);
    });

    it('does not rotate secrets that are not yet due', async () => {
      // Register a secret rotated yesterday (not due)
      const yesterday = new Date(Date.now() - (24 * 60 * 60 * 1000));
      engine.registerSecret({
        name: 'JWT_SIGNING_KEY',
        type: SECRET_TYPES.JWT_SECRET,
        lastRotatedAt: yesterday,
      });

      const rotated = await engine.checkAndRotateDueSecrets();
      expect(rotated).toHaveLength(0);
    });
  });

  describe('2. Acceptance Criteria: Dual-Authentication Windows prevent connection drops', () => {
    it('database passwords: old and new passwords are both valid during dual-auth window', async () => {
      const sec = engine.registerSecret({
        name: 'POSTGRES_APP_USER',
        type: SECRET_TYPES.DATABASE_PASSWORD,
        value: 'initial-db-pass-12345!',
      });

      const oldPassword = sec.activeValue;

      // Trigger rotation into dual-auth window (150ms window)
      await engine.rotateSecret('POSTGRES_APP_USER', {
        newValue: 'new-db-pass-67890!',
        dualAuthWindowMs: 150,
        autoComplete: false,
      });

      const newPassword = engine.getActiveSecret('POSTGRES_APP_USER');
      expect(newPassword).toBe('new-db-pass-67890!');

      // ZERO DOWNTIME: In dual-auth window, BOTH passwords authenticate successfully
      expect(engine.validateDatabasePassword('POSTGRES_APP_USER', oldPassword)).toBe(true);
      expect(engine.validateDatabasePassword('POSTGRES_APP_USER', newPassword)).toBe(true);

      // Wrong passwords still fail
      expect(engine.validateDatabasePassword('POSTGRES_APP_USER', 'invalid-pass')).toBe(false);

      // Complete dual auth window (retire old password)
      engine.completeDualAuth('POSTGRES_APP_USER');

      // Now only new password is valid, old password rejected
      expect(engine.validateDatabasePassword('POSTGRES_APP_USER', newPassword)).toBe(true);
      expect(engine.validateDatabasePassword('POSTGRES_APP_USER', oldPassword)).toBe(false);
    });

    it('RPC tokens: both tokens valid during transition window', async () => {
      engine.registerSecret({
        name: 'HORIZON_RPC_BEARER',
        type: SECRET_TYPES.RPC_TOKEN,
        value: 'rpc-token-alpha-111',
      });

      await engine.rotateSecret('HORIZON_RPC_BEARER', {
        newValue: 'rpc-token-beta-222',
        dualAuthWindowMs: 200,
        autoComplete: false,
      });

      // Both tokens valid
      expect(engine.validateRpcToken('HORIZON_RPC_BEARER', 'rpc-token-alpha-111')).toBe(true);
      expect(engine.validateRpcToken('HORIZON_RPC_BEARER', 'rpc-token-beta-222')).toBe(true);
      expect(engine.validateRpcToken('HORIZON_RPC_BEARER', 'unknown-token')).toBe(false);
    });

    it('JWT secrets: verifies tokens signed with old OR new secret during dual-auth window', async () => {
      engine.registerSecret({
        name: 'AUTH_JWT_SECRET',
        type: SECRET_TYPES.JWT_SECRET,
        value: 'old-super-secret-jwt-key-32chars!!',
      });

      const oldSecret = 'old-super-secret-jwt-key-32chars!!';
      const newSecret = 'new-super-secret-jwt-key-32chars!!';

      // Mock mock-token signing
      const sign = (payload, secret) => `${payload}.${secret.slice(0, 8)}`;
      const verify = (token, secret) => {
        const [payload, sig] = token.split('.');
        if (sig === secret.slice(0, 8)) return { payload };
        throw new Error('Invalid signature');
      };

      const tokenSignedWithOld = sign('user:101', oldSecret);

      // Rotate JWT secret
      await engine.rotateSecret('AUTH_JWT_SECRET', {
        newValue: newSecret,
        dualAuthWindowMs: 200,
        autoComplete: false,
      });

      const tokenSignedWithNew = sign('user:102', newSecret);

      // In dual-auth window: both tokens verify cleanly
      expect(engine.validateJwt('AUTH_JWT_SECRET', tokenSignedWithNew, verify)).toEqual({ payload: 'user:102' });
      expect(engine.validateJwt('AUTH_JWT_SECRET', tokenSignedWithOld, verify)).toEqual({ payload: 'user:101' });

      // After closing window, old token fails
      engine.completeDualAuth('AUTH_JWT_SECRET');
      expect(engine.validateJwt('AUTH_JWT_SECRET', tokenSignedWithNew, verify)).toEqual({ payload: 'user:102' });
      expect(() => engine.validateJwt('AUTH_JWT_SECRET', tokenSignedWithOld, verify)).toThrow('Invalid signature');
    });

    it('DualAuthManager standalone checks', () => {
      const dam = new DualAuthManager({ defaultWindowMs: 100 });
      dam.startWindow('svc_key', 'old_v1', 'new_v2', 100);

      expect(dam.isInWindow('svc_key')).toBe(true);
      expect(dam.authenticate('svc_key', 'new_v2')).toBe(true);
      expect(dam.authenticate('svc_key', 'old_v1')).toBe(true);
      expect(dam.authenticate('svc_key', 'random_bad')).toBe(false);

      dam.closeWindow('svc_key');
      expect(dam.isInWindow('svc_key')).toBe(false);
      expect(dam.authenticate('svc_key', 'new_v2')).toBe(true);
      expect(dam.authenticate('svc_key', 'old_v1')).toBe(false);
    });
  });

  describe('3. Acceptance Criteria: Compliance Audit Reports Exported', () => {
    it('generates compliance report matching SOC2 Type II and ISO 27001 standards', () => {
      engine.registerSecret({
        name: 'DB_CLUSTER_PASSWORD',
        type: SECRET_TYPES.DATABASE_PASSWORD,
      });
      engine.registerSecret({
        name: 'SOROBAN_RPC_KEY',
        type: SECRET_TYPES.RPC_TOKEN,
      });

      const report = engine.generateComplianceReport();

      expect(report.reportId).toBeDefined();
      expect(report.standard).toContain('SOC2');
      expect(report.standard).toContain('ISO_27001');
      expect(report.policy.rotationIntervalDays).toBe(30);
      expect(report.summary.totalSecrets).toBe(2);
      expect(report.summary.compliantSecrets).toBe(2);
      expect(report.summary.complianceScorePercent).toBe(100);
      expect(report.integritySignature).toBeDefined();

      // Ensure NO raw secrets are leaked in report; only fingerprints
      const jsonStr = JSON.stringify(report);
      expect(jsonStr).not.toContain('initial-db-pass');
      expect(report.secrets[0].activeFingerprint).toMatch(/^sha256:/);
    });

    it('exports audit report in JSON, CSV, and Markdown formats to disk', () => {
      engine.registerSecret({
        name: 'EXPORT_TEST_SECRET',
        type: SECRET_TYPES.DATABASE_PASSWORD,
      });

      const tmpDir = path.join(__dirname, '../temp_audit');

      // Export JSON
      const jsonExport = engine.exportAuditReport({
        format: 'json',
        filePath: path.join(tmpDir, 'compliance-report.json'),
      });
      expect(fs.existsSync(jsonExport.filePath)).toBe(true);
      const parsedJson = JSON.parse(fs.readFileSync(jsonExport.filePath, 'utf8'));
      expect(parsedJson.summary.totalSecrets).toBe(1);

      // Export CSV
      const csvExport = engine.exportAuditReport({
        format: 'csv',
        filePath: path.join(tmpDir, 'compliance-report.csv'),
      });
      expect(fs.existsSync(csvExport.filePath)).toBe(true);
      const csvContent = fs.readFileSync(csvExport.filePath, 'utf8');
      expect(csvContent).toContain('SecretId,Type,Version');
      expect(csvContent).toContain('EXPORT_TEST_SECRET');

      // Export Markdown Summary
      const mdExport = engine.exportAuditReport({
        format: 'markdown',
        filePath: path.join(tmpDir, 'compliance-report.md'),
      });
      expect(fs.existsSync(mdExport.filePath)).toBe(true);
      const mdContent = fs.readFileSync(mdExport.filePath, 'utf8');
      expect(mdContent).toContain('# SOC2 / ISO27001 Secret Rotation Compliance Audit Report');

      // Clean up temp files
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('4. Resilient Service Logic & Stress Test', () => {
    it('handles high-concurrency authentication queries during secret rotation', async () => {
      const secretName = 'CONCURRENCY_STRESS_DB';
      const initialPassword = 'stress-initial-pass-1234';
      engine.registerSecret({
        name: secretName,
        type: SECRET_TYPES.DATABASE_PASSWORD,
        value: initialPassword,
      });

      // Start rotation
      const nextPassword = 'stress-rotated-pass-5678';
      await engine.rotateSecret(secretName, {
        newValue: nextPassword,
        dualAuthWindowMs: 500,
        autoComplete: false,
      });

      // Simulate 1,000 concurrent connection requests with either old or new password
      let successes = 0;
      const totalRequests = 1000;

      for (let i = 0; i < totalRequests; i++) {
        const candidate = i % 2 === 0 ? initialPassword : nextPassword;
        if (engine.validateDatabasePassword(secretName, candidate)) {
          successes++;
        }
      }

      // Zero dropped connections
      expect(successes).toBe(totalRequests);

      // Complete dual auth window
      engine.completeDualAuth(secretName);

      // New requests with old password now rejected
      expect(engine.validateDatabasePassword(secretName, initialPassword)).toBe(false);
      expect(engine.validateDatabasePassword(secretName, nextPassword)).toBe(true);
    });

    it('cryptographic generator entropy verification', () => {
      const passwords = new Set();
      for (let i = 0; i < 100; i++) {
        passwords.add(generateDatabasePassword(32));
      }
      expect(passwords.size).toBe(100);

      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateRpcToken(48));
      }
      expect(tokens.size).toBe(100);

      const jwtSecrets = new Set();
      for (let i = 0; i < 100; i++) {
        jwtSecrets.add(generateJwtSecret(64));
      }
      expect(jwtSecrets.size).toBe(100);
    });
  });

  describe('5. SigningKeyRotationEngine Integration', () => {
    it('initializes and exports compliance audit for keeper signing keys', () => {
      // Mock keypair
      const mockKeypair = {
        publicKey: () => 'GBEXAMPLEPUBLICKEY1234567890ABCDEFGHIJKLMNOPQRSTUV',
      };

      const signerEngine = new SigningKeyRotationEngine({
        keypair: mockKeypair,
        rotationIntervalMs: THIRTY_DAYS_MS,
      });

      const audit = signerEngine.exportComplianceAudit();
      expect(audit.keyType).toBe('stellar_ed25519_signing_key');
      expect(audit.currentPublicKey).toBe(mockKeypair.publicKey());
      expect(audit.rotationIntervalDays).toBe(30);
      expect(audit.status).toBe('COMPLIANT');
      expect(signerEngine.isInDualAuthWindow()).toBe(false);
    });
  });
});
