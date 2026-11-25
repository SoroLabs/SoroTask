import { WalletMultiProvider, type MultiProviderState } from "@/app/lib/wallet-multi-provider";
import { MockWalletProvider } from "@/app/lib/wallet-providers";
import { WalletProviderError } from "@/app/lib/wallet-provider";

function makeManager() {
  const states: MultiProviderState[] = [];
  const mgr = new WalletMultiProvider((s) => states.push(s));
  return { mgr, states };
}

describe("WalletMultiProvider", () => {
  it("registers providers and lists available ones", async () => {
    const { mgr } = makeManager();
    const mock = new MockWalletProvider();
    mgr.register(mock);
    const available = await mgr.getAvailableProviders();
    expect(available).toContain("mock");
  });

  it("emits connecting then connected on successful connect", async () => {
    const { mgr, states } = makeManager();
    mgr.register(new MockWalletProvider());
    await mgr.connect("mock");

    const statuses = states.map((s) => s.status);
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("connected");

    const last = states[states.length - 1];
    expect(last.activeProvider).toBe("mock");
    expect(last.session?.address).toBeTruthy();
  });

  it("emits error when provider is not registered", async () => {
    const { mgr, states } = makeManager();
    await mgr.connect("freighter");
    const last = states[states.length - 1];
    expect(last.status).toBe("error");
    expect(last.error).toContain("freighter");
  });

  it("emits error when provider.connect throws", async () => {
    const { mgr, states } = makeManager();
    const failing = new MockWalletProvider();
    jest.spyOn(failing, "connect").mockRejectedValue(new WalletProviderError("mock", "FAIL", "boom"));
    mgr.register(failing);
    await mgr.connect("mock");

    const last = states[states.length - 1];
    expect(last.status).toBe("error");
    expect(last.error).toBe("boom");
  });

  it("disconnects and emits disconnected state", async () => {
    const { mgr, states } = makeManager();
    mgr.register(new MockWalletProvider());
    await mgr.connect("mock");
    await mgr.disconnect();

    const last = states[states.length - 1];
    expect(last.status).toBe("disconnected");
    expect(last.session).toBeNull();
    expect(last.activeProvider).toBeNull();
  });

  it("getProvider returns undefined for unknown id", () => {
    const { mgr } = makeManager();
    expect(mgr.getProvider("freighter")).toBeUndefined();
  });

  it("getAvailableProviders filters out unavailable", async () => {
    const { mgr } = makeManager();
    const unavailable = new MockWalletProvider();
    jest.spyOn(unavailable, "isAvailable").mockResolvedValue(false);
    mgr.register(unavailable);

    const available = await mgr.getAvailableProviders();
    expect(available).not.toContain("mock");
  });

  it("destroy cleans up without throwing", () => {
    const { mgr } = makeManager();
    expect(() => mgr.destroy()).not.toThrow();
  });
});

describe("MockWalletProvider", () => {
  it("is available", async () => {
    expect(await new MockWalletProvider().isAvailable()).toBe(true);
  });

  it("connect returns futurenet session", async () => {
    const result = await new MockWalletProvider().connect();
    expect(result.address).toBeTruthy();
    expect(result.network).toBe("FUTURENET");
  });

  it("watchChanges receives null on disconnect", async () => {
    const p = new MockWalletProvider();
    const calls: Array<string | null> = [];
    p.watchChanges((addr) => calls.push(addr));
    await p.connect();
    await p.disconnect();
    expect(calls).toContain(null);
  });

  it("stop cleans up watcher", async () => {
    const p = new MockWalletProvider();
    const calls: Array<string | null> = [];
    const stop = p.watchChanges((addr) => calls.push(addr));
    stop();
    await p.connect();
    expect(calls).toHaveLength(0);
  });
});
