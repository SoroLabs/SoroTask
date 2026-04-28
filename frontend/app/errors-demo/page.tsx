"use client";

import { useMemo, useState } from "react";
import { ContractErrorBanner } from "../../src/components/ContractErrorBanner";
import {
  ALL_CONTRACT_ERROR_CATEGORIES,
  mapContractError,
  type ContractErrorCategory,
} from "../../src/lib/errors/contractErrors";
import { RAW_ERROR_FIXTURES } from "../../src/lib/errors/fixtures";

export default function ErrorsDemoPage() {
  const [active, setActive] = useState<ContractErrorCategory>("WALLET_REJECTED");
  const [rawJson, setRawJson] = useState<string>(
    `{ "message": "fetch failed", "name": "NetworkError" }`,
  );
  const [retryCount, setRetryCount] = useState(0);

  const mapped = useMemo(
    () => mapContractError(RAW_ERROR_FIXTURES[active]),
    [active],
  );

  const { customMapped, parseError } = useMemo(() => {
    try {
      return {
        customMapped: mapContractError(JSON.parse(rawJson)),
        parseError: null as string | null,
      };
    } catch (e) {
      return {
        customMapped: null,
        parseError: e instanceof Error ? e.message : String(e),
      };
    }
  }, [rawJson]);

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">
            Contract Error Handling — Spike
          </h1>
          <p className="text-sm text-neutral-400">
            Synthetic errors only. Demonstrates how raw RPC / wallet / contract
            errors are translated into UI feedback. See{" "}
            <code>frontend/docs/contract-error-handling.md</code>.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Categories</h2>
          <div className="flex flex-wrap gap-2">
            {ALL_CONTRACT_ERROR_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActive(cat)}
                className={`px-2.5 py-1 rounded-md text-xs font-mono border transition-colors ${
                  active === cat
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <ContractErrorBanner
            error={mapped}
            onRetry={() => setRetryCount((n) => n + 1)}
            onDismiss={() => setActive("UNKNOWN")}
          />
          <p className="text-xs text-neutral-500">
            Retry button pressed {retryCount} time{retryCount === 1 ? "" : "s"}.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Try a custom error shape</h2>
          <p className="text-sm text-neutral-400">
            Paste any object — the mapper duck-types on{" "}
            <code>message</code>, <code>code</code>, <code>name</code>, and{" "}
            <code>status</code>.
          </p>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            spellCheck={false}
            rows={5}
            className="w-full rounded-md bg-neutral-950 border border-neutral-700 p-3 font-mono text-sm text-neutral-200 focus:ring-2 focus:ring-blue-500 outline-none"
          />
          {parseError && (
            <p className="text-xs text-red-400 font-mono">
              JSON parse error: {parseError}
            </p>
          )}
          {customMapped && <ContractErrorBanner error={customMapped} />}
        </section>
      </div>
    </div>
  );
}
