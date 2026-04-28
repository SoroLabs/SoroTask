import { create } from 'zustand';

export interface Task {
  id: string;
  target: string;
  functionName: string;
  interval: number;
  gasBalance: number;
}

export interface Log {
  id: string;
  taskId: string;
  target: string;
  keeper: string;
  status: 'Success' | 'Failed' | 'Pending';
  timestamp: string;
}

interface AppState {
  // Wallet State
  isWalletConnected: boolean;
  walletAddress: string | null;
  connectWallet: () => void;
  disconnectWallet: () => void;

  // Task State
  tasks: Task[];
  addTask: (task: Omit<Task, 'id'>) => void;

  // Log State
  logs: Log[];
  addLog: (log: Omit<Log, 'id' | 'timestamp'>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Wallet Slice
  isWalletConnected: false,
  walletAddress: null,
  connectWallet: () => set({ isWalletConnected: true, walletAddress: 'GA32...XYZ9' }),
  disconnectWallet: () => set({ isWalletConnected: false, walletAddress: null }),

  // Task Slice
  tasks: [],
  addTask: (task) => set((state) => ({
    tasks: [...state.tasks, { ...task, id: Math.random().toString(36).substring(7) }]
  })),

  // Log Slice (with one initial mock log to match previous UI)
  logs: [
    {
      id: 'log-1',
      taskId: '#1024',
      target: 'CC...A12B',
      keeper: 'GA...99X',
      status: 'Success',
      timestamp: '2 mins ago',
    }
  ],
  addLog: (log) => set((state) => ({
    logs: [
      { ...log, id: Math.random().toString(36).substring(7), timestamp: 'Just now' },
      ...state.logs
    ]
  })),
}));
