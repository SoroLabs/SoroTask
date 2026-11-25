import { create } from "zustand";
import type {
  RPCEndpointConfig,
  RPCNodeHealth,
  RPCHealthState,
  OverallStatus,
} from "@/src/lib/rpc/types";
import { RPCHealthMonitor } from "@/src/lib/rpc/rpcHealthMonitor";
import { DEFAULT_RPC_MONITOR_CONFIG } from "@/src/lib/rpc/constants";

interface RPCHealthStoreState extends RPCHealthState {
  monitor: RPCHealthMonitor | null;

  nodesArray: RPCNodeHealth[];

  setNodes: (nodes: Map<string, RPCNodeHealth>) => void;
  setOverallStatus: (status: OverallStatus) => void;
  setLastUpdatedAt: (timestamp: number | null) => void;
  setIsWorkerActive: (active: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  init: (config?: Partial<typeof DEFAULT_RPC_MONITOR_CONFIG>) => void;
  destroy: () => void;
  addEndpoint: (config: RPCEndpointConfig) => void;
  removeEndpoint: (id: string) => void;
  refreshNow: () => void;
  reset: () => void;
}

const initialState: RPCHealthState = {
  nodes: new Map(),
  overallStatus: "degraded",
  lastUpdatedAt: null,
  isWorkerActive: false,
  isLoading: false,
  error: null,
};

export const useRPCHealthStore = create<RPCHealthStoreState>((set, get) => ({
  ...initialState,
  monitor: null,
  nodesArray: [],

  setNodes: (nodes) => set({ nodes, nodesArray: Array.from(nodes.values()) }),
  setOverallStatus: (overallStatus) => set({ overallStatus }),
  setLastUpdatedAt: (lastUpdatedAt) => set({ lastUpdatedAt }),
  setIsWorkerActive: (isWorkerActive) => set({ isWorkerActive }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  init: (config) => {
    const { monitor } = get();
    if (monitor) return;

    const instance = new RPCHealthMonitor(config);

    instance.subscribe((state) => {
      set({
        nodes: state.nodes,
        nodesArray: Array.from(state.nodes.values()),
        overallStatus: state.overallStatus,
        lastUpdatedAt: state.lastUpdatedAt,
        isWorkerActive: state.isWorkerActive,
        isLoading: state.isLoading,
        error: state.error,
      });
    });

    instance.start();
    set({ monitor: instance });
  },

  destroy: () => {
    const { monitor } = get();
    monitor?.destroy();
    set({ ...initialState, monitor: null, nodesArray: [] });
  },

  addEndpoint: (config) => {
    get().monitor?.addEndpoint(config);
  },

  removeEndpoint: (id) => {
    get().monitor?.removeEndpoint(id);
  },

  refreshNow: () => {
    get().monitor?.refreshNow();
  },

  reset: () => {
    const { monitor } = get();
    monitor?.destroy();
    set({ ...initialState, monitor: null, nodesArray: [] });
  },
}));
