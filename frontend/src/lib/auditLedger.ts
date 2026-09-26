"use client";

/**
 * auditLedger.ts — Client-Side Cryptographic Audit Log (issue #1267).
 *
 * A hash-chained, cryptographically signed client-side ledger of
 * administrative actions (task parameter changes, withdrawals, permission
 * changes…). Every entry records who did it (wallet address), when
 * (timestamp), what changed (canonical-JSON payload), the previous entry's
 * hash (tamper-evident chain), and an ECDSA P-256 signature over the entry
 * hash made by a local signing key. Exporting the ledger yields a CSV/JSON
 * activity trail whose signature proofs can be verified offline with the
 * embedded public key.
 *
 * The signing key lives in the browser (WebCrypto, non-extractable private
 * key); its public key is embedded in every entry so exported trails are
 * self-contained. `cryptoImpl` is injectable so tests can run under Node's
 * webcrypto.
 */

import type { AuditLogEntry } from "../../app/types/auditLog";

export const AUDIT_LEDGER_STORAGE_KEY = "sorotask.audit-ledger";
export const AUDIT_SIGNER_STORAGE_KEY = "sorotask.audit-ledger-signer";

export type AuditEntryPayload = Record<string, unknown>;

export type SignedAuditLogEntry = AuditLogEntry & {
  /** What changed — hashed into the entry. */
  payload: AuditEntryPayload;
  /** sha256 of the canonical payload (the "what" binding). */
  contentHash: string;
  /** Entry hash: sha256 over (contentHash, prevHash, sequence, timestamp).
   *  Doubles as the chain link for the next entry. */
  payloadHash: string;
  /** Chain link: previous entry's payloadHash (null for the first entry). */
  prevHash: string | null;
  /** Base64 ECDSA-P256 signature over the entry hash (UTF-8 bytes). */
  signature: string;
  /** SPKI public key of the local signer (verifies the signature). */
  publicKey: string;
  sequence: number;
};

export type AuditSigner = {
  publicKey: string;
  /** Signs the UTF-8 bytes of the given hash string. */
  sign: (entryHash: string) => Promise<string>;
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function subtleOf(cryptoImpl: typeof globalThis.crypto): SubtleCrypto {
  if (!cryptoImpl?.subtle) {
    throw new Error("WebCrypto is required for the audit ledger");
  }
  return cryptoImpl.subtle;
}

/** Canonical JSON (sorted keys) so hashing is deterministic. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((key) => {
    const entry = (value as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalJson(entry)}`;
  });
  return `{${parts.join(",")}}`;
}

async function sha256Hex(subtle: SubtleCrypto, value: string): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Cryptographic binding for the "what": sha256 over the canonical payload. */
export async function computePayloadHash(
  payload: AuditEntryPayload,
  cryptoImpl: typeof globalThis.crypto = globalThis.crypto,
): Promise<string> {
  return sha256Hex(subtleOf(cryptoImpl), canonicalJson(payload));
}

/**
 * Entry hash — binds payload content, chain position and timestamp:
 * `sha256({contentHash, prevHash, sequence, timestamp})`.
 */
export async function computeEntryHash(
  fields: {
    contentHash: string;
    prevHash: string | null;
    sequence: number;
    timestamp: number;
  },
  cryptoImpl: typeof globalThis.crypto = globalThis.crypto,
): Promise<string> {
  return sha256Hex(
    subtleOf(cryptoImpl),
    canonicalJson({
      contentHash: fields.contentHash,
      prevHash: fields.prevHash,
      sequence: fields.sequence,
      timestamp: fields.timestamp,
    }),
  );
}

/**
 * Create the local audit signer. The private key is non-extractable; only
 * the SPKI public key is returned so exported trails can be verified.
 */
export async function createAuditSigner(
  cryptoImpl: typeof globalThis.crypto = globalThis.crypto,
): Promise<AuditSigner> {
  const subtle = subtleOf(cryptoImpl);
  const keyPair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const spki = await subtle.exportKey("spki", keyPair.publicKey);
  const publicKey = toBase64(new Uint8Array(spki));

  return {
    publicKey,
    sign: async (entryHash: string) => {
      const signature = await subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.privateKey,
        new TextEncoder().encode(entryHash),
      );
      return toBase64(new Uint8Array(signature));
    },
  };
}

/**
 * Append a signed entry to the ledger. The entry is hash-chained to its
 * predecessor, so tampering with any field breaks verification.
 */
export async function appendAuditEntry(
  params: {
    action: string;
    actor: string;
    payload: AuditEntryPayload;
    severity?: AuditLogEntry["severity"];
  },
  options: {
    signer?: AuditSigner;
    storage?: Storage | null;
    cryptoImpl?: typeof globalThis.crypto;
    now?: () => number;
    id?: () => string;
  } = {},
): Promise<SignedAuditLogEntry> {
  const storage =
    options.storage ?? (typeof window === "undefined" ? null : window.localStorage);
  const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
  const signer = options.signer ?? (await createAuditSigner(cryptoImpl));
  const now = options.now ?? (() => Date.now());
  const nextId = options.id ?? (() => crypto.randomUUID());

  const entries = loadAuditLedger(storage);
  const prevHash = entries.length > 0 ? entries[entries.length - 1].payloadHash : null;

  const payload = { ...params.payload, action: params.action, actor: params.actor };
  const contentHash = await computePayloadHash(payload, cryptoImpl);
  const timestamp = now();
  const sequence = entries.length;
  const payloadHash = await computeEntryHash(
    { contentHash, prevHash, sequence, timestamp },
    cryptoImpl,
  );
  const signature = await signer.sign(payloadHash);

  const entry: SignedAuditLogEntry = {
    id: nextId(),
    timestamp,
    action: params.action,
    actor: params.actor,
    payloadHash,
    severity: params.severity ?? "info",
    payload,
    contentHash,
    prevHash,
    signature,
    publicKey: signer.publicKey,
    sequence,
  };

  const next = [...entries, entry];
  if (storage) {
    storage.setItem(AUDIT_LEDGER_STORAGE_KEY, JSON.stringify(next));
  }
  return entry;
}

export function loadAuditLedger(
  storage: Storage | null = typeof window === "undefined" ? null : window.localStorage,
): SignedAuditLogEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(AUDIT_LEDGER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SignedAuditLogEntry[]) : [];
  } catch {
    return [];
  }
}

export type AuditLedgerVerification = {
  valid: boolean;
  brokenAt: number | null;
  reason?: string;
};

/**
 * Verify the whole ledger: every entry's content and entry hashes must
 * recompute, link to its predecessor, and carry a signature that verifies
 * against its embedded public key.
 */
export async function verifyAuditLedger(
  entries: SignedAuditLogEntry[],
  cryptoImpl: typeof globalThis.crypto = globalThis.crypto,
): Promise<AuditLedgerVerification> {
  const subtle = subtleOf(cryptoImpl);

  let prevHash: string | null = null;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];

    if (entry.sequence !== index) {
      return { valid: false, brokenAt: index, reason: "sequence gap" };
    }
    if ((entry.prevHash ?? null) !== prevHash) {
      return { valid: false, brokenAt: index, reason: "chain break" };
    }

    const contentHash = await computePayloadHash(entry.payload, cryptoImpl);
    if (contentHash !== entry.contentHash) {
      return { valid: false, brokenAt: index, reason: "content hash mismatch" };
    }

    const entryHash = await computeEntryHash(
      {
        contentHash: entry.contentHash,
        prevHash: entry.prevHash,
        sequence: entry.sequence,
        timestamp: entry.timestamp,
      },
      cryptoImpl,
    );
    if (entryHash !== entry.payloadHash) {
      return { valid: false, brokenAt: index, reason: "entry hash mismatch" };
    }

    let signatureValid: boolean;
    try {
      const verificationKey = await subtle.importKey(
        "spki",
        fromBase64(entry.publicKey),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      signatureValid = await subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        verificationKey,
        fromBase64(entry.signature),
        new TextEncoder().encode(entry.payloadHash),
      );
    } catch {
      return { valid: false, brokenAt: index, reason: "invalid signature encoding" };
    }
    if (!signatureValid) {
      return { valid: false, brokenAt: index, reason: "invalid signature" };
    }

    prevHash = entry.payloadHash;
  }

  return { valid: true, brokenAt: null };
}

const CSV_COLUMNS = [
  "sequence",
  "id",
  "timestamp",
  "action",
  "actor",
  "severity",
  "payloadHash",
  "prevHash",
  "signature",
] as const;

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Auditable CSV activity trail (issue #1267). */
export function exportAuditCsv(entries: SignedAuditLogEntry[]): string {
  const rows = entries.map((entry) =>
    CSV_COLUMNS.map((column) => {
      const value = entry[column];
      return csvEscape(value === null || value === undefined ? "" : String(value));
    }).join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}

/** Signature-proof JSON export (issue #1267). */
export function exportAuditJson(entries: SignedAuditLogEntry[]): string {
  return JSON.stringify(
    {
      version: 1,
      algorithm: "ECDSA-P256",
      exportedAt: new Date().toISOString(),
      entries,
    },
    null,
    2,
  );
}

/** Trigger a browser download of the exported trail. */
export function downloadAuditExport(
  content: string,
  filename: string,
  mimeType: string,
): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
