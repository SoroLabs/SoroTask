import { CollaborationManager, generateInviteLink } from "../collaboration";

describe("CollaborationManager (Issue #1518)", () => {
  it("generates shareable invite links with encoded token", () => {
    const link = generateInviteLink("token-1234", "https://sorotask.app");
    expect(link).toBe("https://sorotask.app/shared/token-1234");
  });

  it("initializes Yjs CRDT document and tracks collaborative draft changes", () => {
    const manager = new CollaborationManager("room-1", "Alice");
    const draft = manager.getDraft();

    expect(draft.title).toBeDefined();
    expect(draft.cronSchedule).toBeDefined();

    let updatedTitle = "";
    const unsub = manager.onDraftChange((d) => {
      updatedTitle = d.title;
    });

    manager.updateDraftField("title", "Refactored Liquidity Arbitrage");
    expect(updatedTitle).toBe("Refactored Liquidity Arbitrage");

    unsub();
    manager.destroy();
  });

  it("supports co-signing workflow", () => {
    const manager = new CollaborationManager("room-1", "Alice");
    manager.coSignDraft("Alice");
    manager.coSignDraft("Bob");

    const draft = manager.getDraft();
    expect(draft.status).toBe("co_signed");
    expect(draft.coSigners).toContain("Alice");
    expect(draft.coSigners).toContain("Bob");

    manager.destroy();
  });

  it("manages peer presence and cursor tracking", () => {
    const manager = new CollaborationManager("room-1", "Alice");
    manager.updatePresence({ x: 100, y: 200, field: "parameters" });

    const peers = manager.getPeers();
    expect(peers.length).toBe(1);
    expect(peers[0].cursor?.field).toBe("parameters");

    manager.destroy();
  });

  it("handles fallback from WebRTC to WebSocket transport gracefully", () => {
    const manager = new CollaborationManager("room-1", "Alice");
    expect(manager.connectionMode).toBe("webrtc");

    let mode = "";
    const unsub = manager.onConnectionChange((m) => {
      mode = m;
    });

    manager.fallbackToWebSocket();
    expect(mode).toBe("websocket");
    expect(manager.connectionMode).toBe("websocket");

    unsub();
    manager.destroy();
  });
});
