"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import {
  CollaborationManager,
  generateInviteLink,
  type Collaborator,
  type SharedTaskDraft,
  type ConnectionMode,
} from "@/src/lib/collaboration";

export default function SharedPage() {
  const params = useParams();
  const token = (params?.token as string) || "draft-demo";

  const [collab, setCollab] = useState<CollaborationManager | null>(null);
  const [draft, setDraft] = useState<SharedTaskDraft>({
    title: "",
    description: "",
    cronSchedule: "",
    contractAddress: "",
    method: "",
    parameters: {},
    status: "draft",
    coSigners: [],
  });
  const [peers, setPeers] = useState<Collaborator[]>([]);
  const [connectionMode, setConnectionMode] =
    useState<ConnectionMode>("webrtc");
  const [copiedLink, setCopiedLink] = useState(false);
  const [rawParams, setRawParams] = useState(
    '{\n  "minAmount": 100,\n  "maxSlippageBps": 50\n}',
  );

  // Initialize collaboration manager
  useEffect(() => {
    const manager = new CollaborationManager(token);
    setCollab(manager);

    const unsubDraft = manager.onDraftChange((d) => {
      setDraft(d);
      setRawParams(JSON.stringify(d.parameters, null, 2));
    });

    const unsubPeers = manager.onPeersChange((p) => {
      setPeers(p);
    });

    const unsubConn = manager.onConnectionChange((mode) => {
      setConnectionMode(mode);
    });

    return () => {
      unsubDraft();
      unsubPeers();
      unsubConn();
      manager.destroy();
    };
  }, [token]);

  const handleFieldChange = (field: keyof SharedTaskDraft, value: any) => {
    if (!collab) return;
    collab.updateDraftField(field, value);
    collab.updatePresence({ x: 0, y: 0, field });
  };

  const handleParamsBlur = () => {
    try {
      const parsed = JSON.parse(rawParams);
      handleFieldChange("parameters", parsed);
    } catch {
      // Keep local input if invalid JSON
    }
  };

  const handleCopyInvite = () => {
    const link = generateInviteLink(token);
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleToggleFallback = () => {
    if (!collab) return;
    if (connectionMode === "webrtc") {
      collab.fallbackToWebSocket();
    } else {
      collab.setConnectionMode("webrtc");
    }
  };

  const handleCoSign = () => {
    if (!collab) return;
    collab.coSignDraft();
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top bar with presence and WebRTC status */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-neutral-900 border border-neutral-800 shadow-xl">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
              <h1 className="text-xl font-bold tracking-tight">
                Team Workspace Collaborative Editing
              </h1>
            </div>
            <p className="text-xs text-neutral-400 font-mono">
              Session Token: {token}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Connection mode pill */}
            <button
              type="button"
              onClick={handleToggleFallback}
              className={`px-3 py-1.5 rounded-full text-xs font-mono font-medium border flex items-center gap-2 transition ${
                connectionMode === "webrtc"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-400"
              }`}
              title="Click to toggle WebRTC vs WebSocket fallback"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionMode === "webrtc"
                    ? "bg-emerald-400"
                    : "bg-amber-400"
                }`}
              />
              {connectionMode === "webrtc"
                ? "WebRTC P2P Data Channel"
                : "WebSocket Transport (Fallback)"}
            </button>

            {/* Invite link button */}
            <button
              type="button"
              onClick={handleCopyInvite}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition shadow-sm"
              data-testid="copy-invite-btn"
            >
              {copiedLink ? "✓ Copied Link" : "Share Draft Invite"}
            </button>
          </div>
        </header>

        {/* Presence ribbon */}
        <section
          className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-center justify-between gap-4"
          aria-label="Active Collaborators"
        >
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-neutral-400">
              Active Team Members ({peers.length}):
            </span>
            <div className="flex items-center -space-x-2">
              {peers.map((peer) => (
                <div
                  key={peer.id}
                  className="relative group w-8 h-8 rounded-full border-2 border-neutral-900 flex items-center justify-center text-xs font-bold text-white shadow-md cursor-pointer"
                  style={{ backgroundColor: peer.color }}
                  title={`${peer.name} ${peer.id === collab?.currentUser.id ? "(You)" : ""}`}
                >
                  {peer.name.charAt(0).toUpperCase()}
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-neutral-800 text-neutral-200 text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-20">
                    {peer.name} {peer.id === collab?.currentUser.id && "(You)"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Active field indicators from remote peers */}
          <div className="text-xs text-neutral-400 hidden sm:block">
            Live simultaneous updates merged via Yjs CRDTs
          </div>
        </section>

        {/* Collaborative Task Draft Form */}
        <main className="p-6 rounded-2xl bg-neutral-900 border border-neutral-800 shadow-xl space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
            <h2 className="text-base font-semibold">
              Automation Task Specification
            </h2>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-medium uppercase ${
                  draft.status === "co_signed"
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    : "bg-neutral-800 text-neutral-400"
                }`}
              >
                Status: {draft.status}
              </span>
            </div>
          </div>

          {/* Field: Title */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-neutral-300">
                Task Title
              </label>
              {peers
                .filter(
                  (p) =>
                    p.id !== collab?.currentUser.id &&
                    p.cursor?.field === "title",
                )
                .map((p) => (
                  <span
                    key={p.id}
                    className="text-[10px] px-2 py-0.5 rounded font-medium"
                    style={{ backgroundColor: p.color, color: "#fff" }}
                  >
                    {p.name} is editing...
                  </span>
                ))}
            </div>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => handleFieldChange("title", e.target.value)}
              onFocus={() =>
                collab?.updatePresence({ x: 0, y: 0, field: "title" })
              }
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2.5 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition"
              data-testid="draft-title-input"
            />
          </div>

          {/* Field: Description */}
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
              Description
            </label>
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => handleFieldChange("description", e.target.value)}
              onFocus={() =>
                collab?.updatePresence({ x: 0, y: 0, field: "description" })
              }
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          {/* Field Grid: Contract & Cron */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                Contract Address
              </label>
              <input
                type="text"
                value={draft.contractAddress}
                onChange={(e) =>
                  handleFieldChange("contractAddress", e.target.value)
                }
                onFocus={() =>
                  collab?.updatePresence({
                    x: 0,
                    y: 0,
                    field: "contractAddress",
                  })
                }
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-xs font-mono text-neutral-100 focus:outline-none focus:border-blue-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                Method
              </label>
              <input
                type="text"
                value={draft.method}
                onChange={(e) => handleFieldChange("method", e.target.value)}
                onFocus={() =>
                  collab?.updatePresence({ x: 0, y: 0, field: "method" })
                }
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-xs font-mono text-neutral-100 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          {/* Field: Cron Schedule */}
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
              Cron Schedule
            </label>
            <input
              type="text"
              value={draft.cronSchedule}
              onChange={(e) =>
                handleFieldChange("cronSchedule", e.target.value)
              }
              onFocus={() =>
                collab?.updatePresence({ x: 0, y: 0, field: "cronSchedule" })
              }
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-xs font-mono text-neutral-100 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          {/* Field: Parameters JSON */}
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
              Task Parameters (JSON)
            </label>
            <textarea
              rows={4}
              value={rawParams}
              onChange={(e) => setRawParams(e.target.value)}
              onBlur={handleParamsBlur}
              onFocus={() =>
                collab?.updatePresence({ x: 0, y: 0, field: "parameters" })
              }
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-xs font-mono text-neutral-100 focus:outline-none focus:border-blue-500 transition"
              data-testid="draft-params-input"
            />
          </div>

          {/* Co-Signing Section */}
          <div className="pt-4 border-t border-neutral-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-xs text-neutral-400 block">
                Co-Signers ({draft.coSigners?.length || 0}):
              </span>
              <span className="text-xs font-mono text-purple-400">
                {draft.coSigners?.length
                  ? draft.coSigners.join(", ")
                  : "None yet"}
              </span>
            </div>

            <button
              type="button"
              onClick={handleCoSign}
              className="px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white transition shadow-md"
              data-testid="co-sign-btn"
            >
              Co-Sign Draft as {collab?.currentUser.name}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
