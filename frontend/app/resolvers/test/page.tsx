"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { CronScheduler } from "@/src/components/CronScheduler";

interface ResolverResult {
  passed: boolean;
  expected: boolean;
  message: string;
}

export default function ResolverTestbedPage() {
  const [address, setAddress] = useState("");
  const [minimumBalance, setMinimumBalance] = useState("100");
  const [targetBalance, setTargetBalance] = useState("125");
  const [ledgerTime, setLedgerTime] = useState("2026-09-26T12:00");
  const [earliestTime, setEarliestTime] = useState("2026-09-26T10:00");
  const [expected, setExpected] = useState("true");
  const [result, setResult] = useState<ResolverResult | null>(null);

  function simulate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const balance = Number(targetBalance);
    const minimum = Number(minimumBalance);
    const ledger = Date.parse(ledgerTime);
    const earliest = Date.parse(earliestTime);
    const valid =
      Boolean(address.trim()) &&
      Number.isFinite(balance) &&
      Number.isFinite(minimum) &&
      balance >= 0 &&
      minimum >= 0 &&
      Number.isFinite(ledger) &&
      Number.isFinite(earliest);
    const passed = valid && balance >= minimum && ledger >= earliest;
    const expectedOutcome = expected === "true";
    setResult({
      passed,
      expected: passed === expectedOutcome,
      message: !valid
        ? "Enter a resolver address and valid, non-negative simulation values."
        : passed
          ? "Resolver condition is true: target balance and ledger time satisfy the configured checks."
          : "Resolver condition is false: the target balance or ledger time is below its threshold.",
    });
  }

  return (
    <main className="min-h-screen bg-[#07100f] px-4 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/"
          className="text-sm text-emerald-300 hover:text-emerald-200"
        >
          ← SoroTask
        </Link>
        <h1 className="mt-5 text-3xl font-bold">Resolver condition testbed</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Test a balance and ledger-time condition against a simulated ledger
          before creating a task. No transaction is submitted.
        </p>

        <form
          onSubmit={simulate}
          className="mt-8 grid gap-5 rounded-2xl border border-white/10 bg-slate-900/70 p-6 sm:grid-cols-2"
        >
          <label className="text-sm text-slate-300 sm:col-span-2">
            Resolver contract address
            <input
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="C…"
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Target balance
            <input
              type="number"
              min="0"
              step="any"
              required
              value={targetBalance}
              onChange={(e) => setTargetBalance(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Minimum balance condition
            <input
              type="number"
              min="0"
              step="any"
              required
              value={minimumBalance}
              onChange={(e) => setMinimumBalance(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Simulated ledger timestamp
            <input
              type="datetime-local"
              required
              value={ledgerTime}
              onChange={(e) => setLedgerTime(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Condition becomes eligible at
            <input
              type="datetime-local"
              required
              value={earliestTime}
              onChange={(e) => setEarliestTime(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Expected resolver result
            <select
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
            >
              <option value="true">Condition evaluates true</option>
              <option value="false">Condition evaluates false</option>
            </select>
          </label>
          <div className="flex items-end">
            <button className="w-full rounded-lg bg-emerald-400 px-4 py-2.5 font-semibold text-slate-950 hover:bg-emerald-300">
              Run simulation
            </button>
          </div>
        </form>

        {result && (
          <section
            aria-live="polite"
            className={`mt-5 rounded-xl border p-5 ${result.expected ? "border-emerald-500/30 bg-emerald-500/10" : "border-rose-500/30 bg-rose-500/10"}`}
          >
            <h2 className="font-semibold">
              {result.expected
                ? "Scenario matches expectation"
                : "Scenario does not match expectation"}
            </h2>
            <p className="mt-2 text-sm text-slate-300">{result.message}</p>
            <p className="mt-2 text-xs text-slate-400">
              Simulated outcome: {result.passed ? "true" : "false"}
            </p>
          </section>
        )}

        {/* Time-Window Resolver Cron Scheduler */}
        <section className="mt-12">
          <CronScheduler />
        </section>
      </div>
    </main>
  );
}
