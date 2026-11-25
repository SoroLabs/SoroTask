"use client";

import { useMemo, useState } from "react";

export interface TransactionReceipt {
  hash: string;
  ledger?: number;
  feeStroops?: string | number;
  returnValue?: unknown;
  network?: "public" | "testnet";
  status?: "success" | "failed";
  createdAt?: string | Date;
}

interface TransactionReceiptModalProps {
  receipt: TransactionReceipt;
  open: boolean;
  onClose: () => void;
}

function decodeScVal(value: unknown): string {
  if (value === undefined || value === null) return "Not provided";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "value" in value) {
    return decodeScVal((value as { value: unknown }).value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function TransactionReceiptModal({ receipt, open, onClose }: TransactionReceiptModalProps) {
  const [copied, setCopied] = useState(false);
  const explorerUrl = useMemo(() => {
    const network = receipt.network === "testnet" ? "testnet" : "public";
    return `https://stellar.expert/explorer/${network}/tx/${encodeURIComponent(receipt.hash)}`;
  }, [receipt.hash, receipt.network]);

  if (!open) return null;

  const copyHash = async () => {
    await navigator.clipboard?.writeText(receipt.hash);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="transaction-receipt-title" className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-neutral-700 bg-neutral-950 p-6 text-neutral-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-neutral-400">SoroTask transaction receipt</p>
            <h2 id="transaction-receipt-title" className="mt-1 text-xl font-semibold">{receipt.status === "failed" ? "Transaction failed" : "Transaction confirmed"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close receipt" className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800">✕</button>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><dt className="text-xs text-neutral-400">Transaction hash</dt><dd className="mt-1 break-all font-mono text-sm">{receipt.hash}</dd></div>
          <div><dt className="text-xs text-neutral-400">Ledger sequence</dt><dd className="mt-1 text-sm">{receipt.ledger ?? "Not provided"}</dd></div>
          <div><dt className="text-xs text-neutral-400">Fee burned</dt><dd className="mt-1 text-sm">{receipt.feeStroops === undefined ? "Not provided" : `${Number(receipt.feeStroops) / 10_000_000} XLM`}</dd></div>
          <div><dt className="text-xs text-neutral-400">Network</dt><dd className="mt-1 text-sm">{receipt.network === "testnet" ? "Stellar Testnet" : "Stellar Public Network"}</dd></div>
          <div><dt className="text-xs text-neutral-400">Recorded at</dt><dd className="mt-1 text-sm">{receipt.createdAt ? new Date(receipt.createdAt).toLocaleString() : "Not provided"}</dd></div>
        </dl>

        <div className="mt-5"><h3 className="text-sm font-medium">Return value (decoded ScVal)</h3><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-800 bg-black/40 p-3 text-xs text-neutral-300">{decodeScVal(receipt.returnValue)}</pre></div>

        <div className="mt-6 flex flex-wrap justify-end gap-2 print:hidden">
          <button type="button" onClick={copyHash} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-900">{copied ? "Copied" : "Copy hash"}</button>
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-blue-700 px-3 py-2 text-sm text-blue-300 hover:bg-blue-950/40">Verify on Stellar Expert</a>
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500">Print / Save PDF</button>
        </div>
      </section>
      <style>{`@media print { body * { visibility: hidden; } [role="dialog"], [role="dialog"] * { visibility: visible; } [role="dialog"] { position: absolute; inset: 0; max-height: none; border: 0; } }`}</style>
    </div>
  );
}
