"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import type { ZkTask } from "@/src/lib/zk-proof";

const ZKProverPanel = dynamic(
  () => import("@/src/components/zk-proof").then((mod) => mod.ZKProverPanel),
  {
    loading: () => (
      <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-8 text-center text-sm text-neutral-400 animate-pulse">
        Loading ZK Prover cryptographic WASM modules...
      </div>
    ),
    ssr: false,
  },
);

export default function ZKProverPage() {
  const [tasks] = useState<ZkTask[]>([
    {
      id: 1,
      contractAddress: "CAFE1234567890ABCDEF1234567890ABCDEF1234",
      functionName: "harvest_yield",
      interval: 3600,
      gasBalance: 10,
      status: "active",
    },
    {
      id: 2,
      contractAddress: "BEEF5678FAILS1234ABCDEF1234567890ABCDEF",
      functionName: "claim_yield",
      interval: 600,
      gasBalance: 5,
      status: "paused",
    },
  ]);

  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress] = useState<string | null>("GABC...XYZ");

  const handleZkVerified = (taskId: number, conditionHash: string) => {
    console.log(`Task #${taskId} verified with hash: ${conditionHash}`);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
              ZK Browser Prover Engine
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              Zero-Knowledge Proof generation and on-chain verification engine
            </p>
          </div>
          <button
            onClick={() => setWalletConnected((prev) => !prev)}
            className={`text-xs font-medium px-4 py-2 rounded-xl border transition ${
              walletConnected
                ? "bg-green-900/20 border-green-800 text-green-300"
                : "bg-neutral-900 border-neutral-800 text-neutral-400"
            }`}
          >
            {walletConnected ? "Wallet Connected" : "Connect Wallet (Demo)"}
          </button>
        </div>

        <ZKProverPanel
          tasks={tasks}
          walletConnected={walletConnected}
          walletAddress={walletAddress}
          onZkVerified={handleZkVerified}
        />
      </div>
    </div>
  );
}
