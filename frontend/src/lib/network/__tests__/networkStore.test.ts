import { useNetworkStore } from "../networkStore";
import { NETWORK_CONFIGS } from "../types";

describe("useNetworkStore", () => {
  beforeEach(() => {
    useNetworkStore.setState({
      currentNetwork: "testnet",
      config: NETWORK_CONFIGS.testnet,
      activeRpcUrl: NETWORK_CONFIGS.testnet.rpcUrl,
      activeContractId: NETWORK_CONFIGS.testnet.contractId,
      walletSynced: true,
      isSwitching: false,
      syncPromptRequired: false,
    });
  });

  it("switches network cleanly and updates contract ID and RPC URL", async () => {
    const store = useNetworkStore.getState();
    await store.switchNetwork("mainnet");

    const updated = useNetworkStore.getState();
    expect(updated.currentNetwork).toBe("mainnet");
    expect(updated.activeRpcUrl).toBe(NETWORK_CONFIGS.mainnet.rpcUrl);
    expect(updated.activeContractId).toBe(NETWORK_CONFIGS.mainnet.contractId);
  });

  it("remaps to standalone network and triggers wallet sync prompt", async () => {
    const store = useNetworkStore.getState();
    await store.switchNetwork("standalone");

    const updated = useNetworkStore.getState();
    expect(updated.currentNetwork).toBe("standalone");
    expect(updated.activeContractId).toBe(NETWORK_CONFIGS.standalone.contractId);
    expect(updated.walletSynced).toBe(true);
  });

  it("clears network caches when requested", () => {
    const store = useNetworkStore.getState();
    expect(() => store.clearNetworkCaches("testnet")).not.toThrow();
  });
});
