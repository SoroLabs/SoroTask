import { webcrypto } from "node:crypto";

import {
  appendAuditEntry,
  bindWalletSigner,
  canonicalJson,
  clearAuditLedger,
  computeEntryHash,
  computePayloadHash,
  createAuditSigner,
  createOnChainAnchor,
  exportAuditCsv,
  exportAuditJson,
  exportAuditJsonLd,
  getLatestAnchor,
  getOrCreateAuditSigner,
  getWalletSignerPublicKey,
  loadAuditAnchors,
  loadAuditLedger,
  logTaskDeleted,
  logTaskInitiated,
  logTaskModified,
  logTaskPaused,
  logTaskResumed,
  resetAuditSigner,
  saveAuditAnchor,
  tamperAuditEntry,
  verifyAuditLedger,
  verifyOnChainAnchor,
  verifyWalletSignature,
  type SignedAuditLogEntry,
} from "./auditLedger";

const CRYPTO = webcrypto as unknown as typeof globalThis.crypto;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function setup() {
  const storage = memoryStorage();
  let counter = 0;
  return {
    storage,
    nextId: () => `entry-${++counter}`,
    now: () => 1_000_000 + counter,
  };
}

describe("client-side audit ledger (issue #1480 / #1267)", () => {
  beforeEach(() => {
    resetAuditSigner();
  });

  it("appends hash-chained, signed entries and verifies the ledger", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    await appendAuditEntry(
      {
        action: "update_task_params",
        actor: "GADMIN",
        payload: { taskId: 42, gasLimit: 5000 },
      },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );
    await appendAuditEntry(
      {
        action: "initiate_withdrawal",
        actor: "GADMIN",
        payload: { amount: 100, taskId: 42 },
        severity: "warning",
      },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    const entries = loadAuditLedger(storage);
    expect(entries).toHaveLength(2);

    // Chain: the first entry has no predecessor, the second links to the first.
    expect(entries[0].prevHash).toBeNull();
    expect(entries[1].prevHash).toBe(entries[0].payloadHash);
    expect(entries[0].sequence).toBe(0);
    expect(entries[1].sequence).toBe(1);

    // Wallet address and timestamp recorded on every entry.
    expect(entries[1].actor).toBe("GADMIN");
    expect(entries[1].timestamp).toBeGreaterThan(0);

    const verification = await verifyAuditLedger(entries, CRYPTO);
    expect(verification).toEqual({
      valid: true,
      brokenAt: null,
      anchored: false,
      walletVerified: undefined,
    });
  });

  it("detects tampering with any recorded field", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    await appendAuditEntry(
      { action: "update_task_params", actor: "GADMIN", payload: { taskId: 42 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );
    await appendAuditEntry(
      { action: "initiate_withdrawal", actor: "GADMIN", payload: { amount: 100 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    const entries = loadAuditLedger(storage);

    // Tamper with the recorded payload of the second entry.
    const tamperedPayload = entries.map((entry, index) =>
      index === 1
        ? { ...entry, payload: { ...entry.payload, amount: 999 } }
        : entry,
    );
    const payloadCheck = await verifyAuditLedger(
      tamperedPayload as SignedAuditLogEntry[],
      CRYPTO,
    );
    expect(payloadCheck.valid).toBe(false);
    expect(payloadCheck.brokenAt).toBe(1);
    expect(payloadCheck.reason).toBe("content hash mismatch");

    // Tampering with the actor field is likewise detected.
    const tamperedActor = entries.map((entry, index) =>
      index === 0 ? { ...entry, actor: "GMALLORY" } : entry,
    );
    const actorCheck = await verifyAuditLedger(
      tamperedActor as SignedAuditLogEntry[],
      CRYPTO,
    );
    expect(actorCheck.valid).toBe(false);
    expect(actorCheck.brokenAt).toBe(0);
  });

  it("detects broken hash chain and sequence gaps", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    await appendAuditEntry(
      { action: "task_1", actor: "GADMIN", payload: { id: 1 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );
    await appendAuditEntry(
      { action: "task_2", actor: "GADMIN", payload: { id: 2 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    const entries = loadAuditLedger(storage);

    // Break chain link
    const brokenChain = [
      entries[0],
      { ...entries[1], prevHash: "00000000000000000000000000000000" },
    ];
    const chainCheck = await verifyAuditLedger(brokenChain as SignedAuditLogEntry[], CRYPTO);
    expect(chainCheck.valid).toBe(false);
    expect(chainCheck.reason).toBe("chain break");

    // Sequence gap
    const sequenceGap = [
      entries[0],
      { ...entries[1], sequence: 5 },
    ];
    const gapCheck = await verifyAuditLedger(sequenceGap as SignedAuditLogEntry[], CRYPTO);
    expect(gapCheck.valid).toBe(false);
    expect(gapCheck.reason).toBe("sequence gap");
  });

  it("fails verification when a signature does not match the signer", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    const entry = await appendAuditEntry(
      { action: "rotate_permissions", actor: "GADMIN", payload: { role: "user" } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    // A forged entry claims a different payloadHash than the signed one.
    const forged = [{ ...entry, payloadHash: entry.payloadHash.slice(0, -2) + "ff" }];
    const verification = await verifyAuditLedger(
      forged as SignedAuditLogEntry[],
      CRYPTO,
    );
    expect(verification.valid).toBe(false);
    expect(verification.brokenAt).toBe(0);
    expect(verification.reason).toBe("entry hash mismatch");
  });

  it("exports an auditable RFC 4180 CSV trail", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    await appendAuditEntry(
      { action: "adjust_task, parameters", actor: "GADMIN", payload: { taskId: 7 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );
    await appendAuditEntry(
      { action: "initiate_withdrawal", actor: "GADMIN", payload: { amount: 5 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    const csv = exportAuditCsv(loadAuditLedger(storage));
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe(
      "sequence,id,timestamp,action,actor,severity,payloadHash,prevHash,signature",
    );
    expect(lines).toHaveLength(3);
    // Commas inside values are quoted per RFC 4180.
    expect(lines[1]).toContain('"adjust_task, parameters"');
    // Each row carries the verifiable signature proof.
    expect(lines[2]).toContain("GADMIN");

    // Also supports custom line endings (e.g. LF) if requested
    const csvLf = exportAuditCsv(loadAuditLedger(storage), { crlf: false });
    expect(csvLf.split("\n")).toHaveLength(3);
  });

  it("exports standard JSON and W3C JSON-LD trails", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    await appendAuditEntry(
      { action: "update_task_params", actor: "GADMIN", payload: { taskId: 1 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    const entries = loadAuditLedger(storage);

    // Standard JSON
    const jsonExport = JSON.parse(exportAuditJson(entries));
    expect(jsonExport.version).toBe(1);
    expect(jsonExport.algorithm).toBe("ECDSA-P256");
    expect(jsonExport.entries).toHaveLength(1);
    expect(typeof jsonExport.entries[0].signature).toBe("string");

    // W3C JSON-LD
    const jsonLdExport = JSON.parse(exportAuditJsonLd(entries));
    expect(jsonLdExport["@context"]).toBeDefined();
    expect(jsonLdExport["@type"]).toBe("AuditLedger");
    expect(jsonLdExport["@id"]).toBe("urn:sorotask:audit-ledger");
    expect(jsonLdExport.entries).toHaveLength(1);
    expect(jsonLdExport.entries[0]["@type"]).toBe("AuditLogEntry");
    expect(jsonLdExport.entries[0].proof["@type"]).toBe("sec:EcdsaSecp256r1Signature2019");
    expect(jsonLdExport.entries[0].proof.creator).toBe("urn:stellar:address:GADMIN");
    expect(jsonLdExport.entries[0].proof.proofValue).toBe(entries[0].signature);
  });

  it("creates and verifies on-chain cryptographic anchors", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    await appendAuditEntry(
      { action: "task_1", actor: "GADMIN", payload: { taskId: 1 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );
    await appendAuditEntry(
      { action: "task_2", actor: "GADMIN", payload: { taskId: 2 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    const entries = loadAuditLedger(storage);
    const anchor = createOnChainAnchor(entries, {
      txHash: "0x1234567890abcdef",
      network: "futurenet",
      now: () => 1_000_100,
      id: () => "anchor-1",
    });

    expect(anchor.sequence).toBe(1);
    expect(anchor.rootHash).toBe(entries[1].payloadHash);
    expect(anchor.txHash).toBe("0x1234567890abcdef");

    // Anchor verification succeeds on matching ledger
    const check = verifyOnChainAnchor(entries, anchor);
    expect(check.valid).toBe(true);

    // Save and verify through verifyAuditLedger with storage anchor
    saveAuditAnchor(anchor, storage);
    const loadedAnchors = loadAuditAnchors(storage);
    expect(loadedAnchors).toHaveLength(1);
    expect(getLatestAnchor(storage)?.anchorId).toBe("anchor-1");

    const ledgerVerify = await verifyAuditLedger(entries, CRYPTO, { storage });
    expect(ledgerVerify.valid).toBe(true);
    expect(ledgerVerify.anchored).toBe(true);
    expect(ledgerVerify.anchorTxHash).toBe("0x1234567890abcdef");

    // Truncating the ledger breaks on-chain anchor verification
    const truncatedLedger = [entries[0]];
    const truncateCheck = verifyOnChainAnchor(truncatedLedger, anchor);
    expect(truncateCheck.valid).toBe(false);
    expect(truncateCheck.reason).toContain("Anchored sequence #1 not found");

    // Modifying the head hash breaks on-chain anchor verification
    const modifiedAnchor = { ...anchor, rootHash: "tampered_root_hash" };
    const tamperedAnchorCheck = verifyOnChainAnchor(entries, modifiedAnchor);
    expect(tamperedAnchorCheck.valid).toBe(false);
    expect(tamperedAnchorCheck.reason).toContain("Anchor root hash mismatch");
  });

  it("binds wallet to non-extractable keys and verifies wallet signatures", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    const walletAddress = "GUSER123456789";
    bindWalletSigner(walletAddress, signer.publicKey, storage);
    expect(getWalletSignerPublicKey(walletAddress, storage)).toBe(signer.publicKey);

    const entry = await appendAuditEntry(
      { action: "admin:action", actor: walletAddress, payload: { privileged: true } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    // Valid wallet verification
    const validCheck = await verifyWalletSignature(entry, walletAddress, storage, CRYPTO);
    expect(validCheck.valid).toBe(true);

    // Mismatched wallet address fails
    const mismatchCheck = await verifyWalletSignature(entry, "GDIF_WALLET", storage, CRYPTO);
    expect(mismatchCheck.valid).toBe(false);
    expect(mismatchCheck.reason).toContain("does not match expected wallet");

    // Bound public key mismatch fails
    bindWalletSigner(walletAddress, "FORGED_KEY", storage);
    const forgedKeyCheck = await verifyWalletSignature(entry, walletAddress, storage, CRYPTO);
    expect(forgedKeyCheck.valid).toBe(false);
    expect(forgedKeyCheck.reason).toContain("does not match bound public key");
  });

  it("supports high-level automation action logging helpers", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);
    const actor = "GOPERATOR";

    await logTaskInitiated(101, actor, { schedule: "0 * * * *" }, { signer, storage, cryptoImpl: CRYPTO, now, id: nextId });
    await logTaskModified(101, actor, { retries: 3 }, { signer, storage, cryptoImpl: CRYPTO, now, id: nextId });
    await logTaskPaused(101, actor, "Maintenance window", { signer, storage, cryptoImpl: CRYPTO, now, id: nextId });
    await logTaskResumed(101, actor, "Maintenance complete", { signer, storage, cryptoImpl: CRYPTO, now, id: nextId });
    await logTaskDeleted(101, actor, "Deprecated pipeline", { signer, storage, cryptoImpl: CRYPTO, now, id: nextId });

    const entries = loadAuditLedger(storage);
    expect(entries).toHaveLength(5);
    expect(entries[0].action).toBe("task:initiated");
    expect(entries[1].action).toBe("task:modified");
    expect(entries[2].action).toBe("task:paused");
    expect(entries[3].action).toBe("task:resumed");
    expect(entries[4].action).toBe("task:deleted");

    const verification = await verifyAuditLedger(entries, CRYPTO);
    expect(verification.valid).toBe(true);
  });

  it("tamperAuditEntry simulates tampering and is immediately caught", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    await appendAuditEntry(
      { action: "task_run", actor: "GADMIN", payload: { runId: 1 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    tamperAuditEntry(0, { action: "unauthorized_tampered_action" }, storage);
    const tamperedEntries = loadAuditLedger(storage);

    const verification = await verifyAuditLedger(tamperedEntries, CRYPTO);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAt).toBe(0);
  });

  it("computes stable content and entry hashes", async () => {
    const contentHash = await computePayloadHash({ a: 1, b: "x" }, CRYPTO);
    const contentHashReordered = await computePayloadHash({ b: "x", a: 1 }, CRYPTO);
    expect(contentHash).toBe(contentHashReordered);

    const entryHash = await computeEntryHash(
      { contentHash, prevHash: null, sequence: 0, timestamp: 5 },
      CRYPTO,
    );
    const entryHashSame = await computeEntryHash(
      { contentHash, prevHash: null, sequence: 0, timestamp: 5 },
      CRYPTO,
    );
    const entryHashDifferent = await computeEntryHash(
      { contentHash, prevHash: null, sequence: 1, timestamp: 5 },
      CRYPTO,
    );
    expect(entryHash).toBe(entryHashSame);
    expect(entryHash).not.toBe(entryHashDifferent);
  });
});
