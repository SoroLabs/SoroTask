import { webcrypto } from "node:crypto";

import {
  appendAuditEntry,
  computeEntryHash,
  computePayloadHash,
  createAuditSigner,
  exportAuditCsv,
  exportAuditJson,
  loadAuditLedger,
  verifyAuditLedger,
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

describe("client-side audit ledger (issue #1267)", () => {
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
    expect(verification).toEqual({ valid: true, brokenAt: null });
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

  it("exports an auditable CSV trail", async () => {
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
    const lines = csv.split("\n");

    expect(lines[0]).toBe(
      "sequence,id,timestamp,action,actor,severity,payloadHash,prevHash,signature",
    );
    expect(lines).toHaveLength(3);
    // Commas inside values are quoted per RFC 4180.
    expect(lines[1]).toContain('"adjust_task, parameters"');
    // Each row carries the verifiable signature proof.
    expect(lines[2]).toContain("GADMIN");
  });

  it("exports a JSON trail with algorithm metadata", async () => {
    const { storage, nextId, now } = setup();
    const signer = await createAuditSigner(CRYPTO);

    await appendAuditEntry(
      { action: "update_task_params", actor: "GADMIN", payload: { taskId: 1 } },
      { signer, storage, cryptoImpl: CRYPTO, now, id: nextId },
    );

    const exported = JSON.parse(exportAuditJson(loadAuditLedger(storage)));
    expect(exported.version).toBe(1);
    expect(exported.algorithm).toBe("ECDSA-P256");
    expect(exported.entries).toHaveLength(1);
    expect(typeof exported.entries[0].signature).toBe("string");
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
