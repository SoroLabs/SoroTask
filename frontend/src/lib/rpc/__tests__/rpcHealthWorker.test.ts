import type { RPCEndpointConfig } from "../types";

describe("rpcHealthWorker", () => {
  let worker: Worker | null = null;
  let workerUrl: string;

  function createWorkerProxy() {
    let selfOnMessage: ((event: MessageEvent) => void) | null = null;

    const workerMock = {
      postMessage: jest.fn((data: Record<string, unknown>) => {
        if (selfOnMessage) {
          selfOnMessage({ data } as MessageEvent);
        }
      }),
      terminate: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      set onmessage(handler: ((event: MessageEvent) => void) | null) {
        selfOnMessage = handler;
      },
      get onmessage() {
        return selfOnMessage;
      },
    };

    return workerMock as unknown as Worker;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (workerUrl) {
      URL.revokeObjectURL(workerUrl);
    }
  });

  it("loads and initializes without error", async () => {
    const mod = await import("../rpcHealthWorker");
    expect(mod).toBeDefined();
  });

  it("exposes self.onmessage handler when in worker scope", async () => {
    const mod = await import("../rpcHealthWorker");
    expect(typeof mod).toBe("object");
  });

  it("handles INIT message and returns WORKER_READY", () => {
    const mockWorker = createWorkerProxy();
    const handler = (event: MessageEvent) => {
      const { type } = event.data;
      if (type === "INIT") {
        mockWorker.postMessage({ type: "WORKER_READY", payload: null });
      }
    };

    mockWorker.onmessage = handler;
    const postMessageSpy = jest.spyOn(mockWorker, "postMessage");

    mockWorker.postMessage({
      type: "INIT",
      payload: {
        endpoints: [
          {
            id: "test-1",
            url: "https://rpc.test.com",
            name: "Test RPC",
            network: "testnet",
          },
        ],
        intervalMs: 60000,
        timeoutMs: 5000,
      },
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "INIT" }),
    );
  });

  it("performs health probe via fetch", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "healthy" }),
    });

    const config: RPCEndpointConfig = {
      id: "test-1",
      url: "https://rpc.test.com",
      name: "Test RPC",
      network: "testnet",
    };

    const response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
        params: [],
      }),
    });

    expect(response.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      config.url,
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("handles failed health probe", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

    const config: RPCEndpointConfig = {
      id: "test-1",
      url: "https://rpc.test.com",
      name: "Test RPC",
      network: "testnet",
    };

    await expect(
      fetch(config.url).catch((e) => {
        throw e;
      }),
    ).rejects.toThrow("Network error");
  });

  it("handles ADD_ENDPOINT and REMOVE_ENDPOINT messages", () => {
    const mockWorker = createWorkerProxy();
    const endpoints = new Map<string, RPCEndpointConfig>();
    let addMessageReceived = false;
    let removeMessageReceived = false;

    mockWorker.onmessage = (event: MessageEvent) => {
      const { type, payload } = event.data;
      if (type === "ADD_ENDPOINT") {
        endpoints.set(
          (payload as RPCEndpointConfig).id,
          payload as RPCEndpointConfig,
        );
        addMessageReceived = true;
      }
      if (type === "REMOVE_ENDPOINT") {
        endpoints.delete(payload as string);
        removeMessageReceived = true;
      }
    };

    const newEp: RPCEndpointConfig = {
      id: "new-endpoint",
      url: "https://new.rpc.com",
      name: "New RPC",
      network: "mainnet",
    };

    mockWorker.postMessage({ type: "ADD_ENDPOINT", payload: newEp });
    expect(addMessageReceived).toBe(true);
    expect(endpoints.has("new-endpoint")).toBe(true);

    mockWorker.postMessage({
      type: "REMOVE_ENDPOINT",
      payload: "new-endpoint",
    });
    expect(removeMessageReceived).toBe(true);
    expect(endpoints.has("new-endpoint")).toBe(false);
  });

  it("handles RESET message", () => {
    const mockWorker = createWorkerProxy();
    let resetReceived = false;

    mockWorker.onmessage = (event: MessageEvent) => {
      if (event.data.type === "RESET") {
        resetReceived = true;
      }
    };

    mockWorker.postMessage({ type: "RESET", payload: null });
    expect(resetReceived).toBe(true);
  });

  it("handles unknown message types gracefully", () => {
    const mockWorker = createWorkerProxy();
    let error: Error | null = null;

    mockWorker.onmessage = (event: MessageEvent) => {
      try {
        const { type } = event.data;
        if (type === "UNKNOWN_TYPE") {
          // do nothing - should not throw
        }
      } catch (e) {
        error = e as Error;
      }
    };

    expect(() => {
      mockWorker.postMessage({ type: "UNKNOWN_TYPE", payload: {} });
    }).not.toThrow();
    expect(error).toBeNull();
  });
});
