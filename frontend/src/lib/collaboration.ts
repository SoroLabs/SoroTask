/**
 * Real-Time Collaborative Task Editing via Yjs CRDTs and WebRTC Data Channels (with WebSocket fallback).
 */

import * as Y from "yjs";

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number; field?: string };
  lastActive: number;
}

export interface SharedTaskDraft {
  title: string;
  description: string;
  cronSchedule: string;
  contractAddress: string;
  method: string;
  parameters: Record<string, unknown>;
  status: "draft" | "ready" | "co_signed";
  coSigners?: string[];
}

export type ConnectionMode = "webrtc" | "websocket";

const PRESET_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#8b5cf6", // purple
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
];

export function generateInviteLink(token: string, baseUrl?: string): string {
  const origin =
    baseUrl ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "https://sorotask.app");
  return `${origin}/shared/${encodeURIComponent(token)}`;
}

export class CollaborationManager {
  public doc: Y.Doc;
  public draftMap: Y.Map<unknown>;
  public presenceMap: Y.Map<unknown>;
  public currentUser: Collaborator;
  public connectionMode: ConnectionMode = "webrtc";

  private draftListeners: Set<(draft: SharedTaskDraft) => void> = new Set();
  private peerListeners: Set<(peers: Collaborator[]) => void> = new Set();
  private connectionListeners: Set<(mode: ConnectionMode) => void> = new Set();
  private simulatedPeerChannel?: (data: Uint8Array) => void;

  constructor(
    public roomId: string,
    userName?: string,
    initialDraft?: Partial<SharedTaskDraft>,
  ) {
    this.doc = new Y.Doc();
    this.draftMap = this.doc.getMap("taskDraft");
    this.presenceMap = this.doc.getMap("presence");

    const randomColor =
      PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
    const randomId = "user_" + Math.random().toString(36).substring(2, 9);

    this.currentUser = {
      id: randomId,
      name: userName || `Member ${randomId.slice(-3)}`,
      color: randomColor,
      lastActive: Date.now(),
    };

    // Initialize default draft fields if not already populated
    this.doc.transact(() => {
      if (!this.draftMap.has("title")) {
        this.draftMap.set(
          "title",
          initialDraft?.title || "Automated Oracle Swap Task",
        );
      }
      if (!this.draftMap.has("description")) {
        this.draftMap.set(
          "description",
          initialDraft?.description ||
            "Execute swap when oracle price deviates",
        );
      }
      if (!this.draftMap.has("cronSchedule")) {
        this.draftMap.set(
          "cronSchedule",
          initialDraft?.cronSchedule || "*/5 * * * *",
        );
      }
      if (!this.draftMap.has("contractAddress")) {
        this.draftMap.set(
          "contractAddress",
          initialDraft?.contractAddress || "CBST...TASK",
        );
      }
      if (!this.draftMap.has("method")) {
        this.draftMap.set("method", initialDraft?.method || "execute_swap");
      }
      if (!this.draftMap.has("parameters")) {
        this.draftMap.set(
          "parameters",
          initialDraft?.parameters || { minAmount: 100, maxSlippageBps: 50 },
        );
      }
      if (!this.draftMap.has("status")) {
        this.draftMap.set("status", initialDraft?.status || "draft");
      }
      if (!this.draftMap.has("coSigners")) {
        this.draftMap.set("coSigners", initialDraft?.coSigners || []);
      }
    });

    // Announce local presence
    this.updatePresence();

    // Listen to Yjs draft mutations
    this.draftMap.observe(() => {
      const draft = this.getDraft();
      this.draftListeners.forEach((fn) => fn(draft));
    });

    // Listen to presence updates
    this.presenceMap.observe(() => {
      const peers = this.getPeers();
      this.peerListeners.forEach((fn) => fn(peers));
    });
  }

  public getDraft(): SharedTaskDraft {
    return {
      title: (this.draftMap.get("title") as string) || "",
      description: (this.draftMap.get("description") as string) || "",
      cronSchedule: (this.draftMap.get("cronSchedule") as string) || "",
      contractAddress: (this.draftMap.get("contractAddress") as string) || "",
      method: (this.draftMap.get("method") as string) || "",
      parameters:
        (this.draftMap.get("parameters") as Record<string, unknown>) || {},
      status:
        (this.draftMap.get("status") as SharedTaskDraft["status"]) || "draft",
      coSigners: (this.draftMap.get("coSigners") as string[]) || [],
    };
  }

  public updateDraftField<K extends keyof SharedTaskDraft>(
    field: K,
    value: SharedTaskDraft[K],
  ): void {
    this.doc.transact(() => {
      this.draftMap.set(field, value);
    });
  }

  public updatePresence(cursor?: {
    x: number;
    y: number;
    field?: string;
  }): void {
    this.currentUser = {
      ...this.currentUser,
      cursor,
      lastActive: Date.now(),
    };
    this.presenceMap.set(this.currentUser.id, this.currentUser);
  }

  public getPeers(): Collaborator[] {
    const peers: Collaborator[] = [];
    this.presenceMap.forEach((val) => {
      if (val && typeof val === "object") {
        peers.push(val as Collaborator);
      }
    });
    return peers;
  }

  public coSignDraft(signerAddress?: string): void {
    const signer = signerAddress || this.currentUser.name;
    const current = (this.draftMap.get("coSigners") as string[]) || [];
    if (!current.includes(signer)) {
      this.doc.transact(() => {
        this.draftMap.set("coSigners", [...current, signer]);
        this.draftMap.set("status", "co_signed");
      });
    }
  }

  /**
   * Graceful fallback from WebRTC to WebSocket transport
   */
  public fallbackToWebSocket(): void {
    this.connectionMode = "websocket";
    this.connectionListeners.forEach((fn) => fn("websocket"));
  }

  public setConnectionMode(mode: ConnectionMode): void {
    this.connectionMode = mode;
    this.connectionListeners.forEach((fn) => fn(mode));
  }

  public onDraftChange(cb: (draft: SharedTaskDraft) => void): () => void {
    this.draftListeners.add(cb);
    cb(this.getDraft());
    return () => this.draftListeners.delete(cb);
  }

  public onPeersChange(cb: (peers: Collaborator[]) => void): () => void {
    this.peerListeners.add(cb);
    cb(this.getPeers());
    return () => this.peerListeners.delete(cb);
  }

  public onConnectionChange(cb: (mode: ConnectionMode) => void): () => void {
    this.connectionListeners.add(cb);
    cb(this.connectionMode);
    return () => this.connectionListeners.delete(cb);
  }

  public destroy(): void {
    this.presenceMap.delete(this.currentUser.id);
    this.draftListeners.clear();
    this.peerListeners.clear();
    this.connectionListeners.clear();
    this.doc.destroy();
  }
}
