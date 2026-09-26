"use client";

import { useState } from "react";

const steps = ["Fund demo wallet", "Choose a contract", "Run a test task"] as const;

export default function SandboxPage() {
  const [step, setStep] = useState(0);
  const [funded, setFunded] = useState(false);
  const [contract, setContract] = useState("");
  const [executed, setExecuted] = useState(false);

  const advance = () => setStep((current) => Math.min(current + 1, steps.length - 1));

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-neutral-100">
      <header className="mb-8">
        <p className="text-sm font-medium text-blue-300">Interactive onboarding · Sandbox</p>
        <h1 className="mt-2 text-3xl font-bold">Try a task without risk</h1>
        <p className="mt-3 max-w-2xl text-neutral-400">Complete this short simulation using demo credits and a mock contract. Nothing is sent to a wallet or written on-chain.</p>
      </header>

      <ol aria-label="Sandbox steps" className="mb-8 grid gap-2 sm:grid-cols-3">
        {steps.map((title, index) => (
          <li key={title} aria-current={step === index ? "step" : undefined} className={`rounded-lg border p-3 text-sm ${step === index ? "border-blue-500 bg-blue-950/40 text-blue-100" : index < step ? "border-emerald-800 text-emerald-300" : "border-neutral-800 text-neutral-500"}`}>
            <span className="mr-2">{index < step ? "✓" : index + 1}</span>{title}
          </li>
        ))}
      </ol>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-6">
        {step === 0 && <>
          <h2 className="text-xl font-semibold">Add demo credits</h2>
          <p className="mt-2 text-sm text-neutral-400">The sandbox uses a pretend balance so you can learn the funding step safely.</p>
          <div className="mt-5 flex items-center justify-between rounded-lg bg-neutral-950 p-4"><span className="text-sm text-neutral-400">Demo balance</span><strong>{funded ? "10,000 demo credits" : "0 demo credits"}</strong></div>
          <button type="button" onClick={() => { setFunded(true); advance(); }} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500">Add demo credits</button>
        </>}

        {step === 1 && <>
          <h2 className="text-xl font-semibold">Select a mock contract</h2>
          <p className="mt-2 text-sm text-neutral-400">Choose a sample target to see how a task connects to a contract function.</p>
          <label className="mt-5 block text-sm" htmlFor="sandbox-contract">Contract</label>
          <select id="sandbox-contract" value={contract} onChange={(event) => setContract(event.target.value)} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm">
            <option value="">Select a demo contract</option>
            <option value="demo-token">Demo Token · balance_of</option>
            <option value="demo-vault">Demo Vault · check_health</option>
          </select>
          <button type="button" disabled={!contract} onClick={advance} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40">Continue</button>
        </>}

        {step === 2 && <>
          <h2 className="text-xl font-semibold">Run a test task</h2>
          <p className="mt-2 text-sm text-neutral-400">Your simulated task will call <code className="rounded bg-neutral-800 px-1">{contract === "demo-token" ? "balance_of" : "check_health"}</code> and spend demo credits only.</p>
          {executed ? <div role="status" className="mt-5 rounded-lg border border-emerald-800 bg-emerald-950/30 p-4"><strong className="text-emerald-300">Simulation complete</strong><p className="mt-1 text-sm text-neutral-300">Task succeeded · 12 demo credits used · No blockchain transaction created.</p></div> : <button type="button" onClick={() => setExecuted(true)} className="mt-5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500">Run simulated task</button>}
          {executed && <button type="button" onClick={() => { setStep(0); setFunded(false); setContract(""); setExecuted(false); }} className="ml-3 rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800">Start again</button>}
        </>}
      </section>

      <p className="mt-4 text-xs text-neutral-500">Sandbox only. No wallet connection, real token transfer, or on-chain execution occurs.</p>
    </main>
  );
}
