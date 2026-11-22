"use client";

import React, { useState } from "react";
import { CrossChainTaskManager } from "./components/CrossChainTaskManager";
import { BridgeMonitor } from "@/src/components/BridgeMonitor";

export default function CrossChainPage() {
  const [activeTab, setActiveTab] = useState<"monitor" | "manager">("monitor");

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌉</span>
            <h1 className="text-lg font-bold">Cross-Chain Automations</h1>
          </div>
          <div
            className="flex items-center bg-neutral-950 p-1 rounded-xl border border-neutral-800"
            role="tablist"
          >
            <button
              role="tab"
              aria-selected={activeTab === "monitor"}
              onClick={() => setActiveTab("monitor")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === "monitor"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Bridge Monitor & State Proofs
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "manager"}
              onClick={() => setActiveTab("manager")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === "manager"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Task Manager
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {activeTab === "monitor" ? (
          <BridgeMonitor />
        ) : (
          <CrossChainTaskManager />
        )}
      </div>
    </div>
  );
}
