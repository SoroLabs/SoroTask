import { create } from 'zustand';
import type { EncryptionKey, EncryptedPayload, RotationResult } from '@/src/lib/encryption/types';

export type EncryptionStatus = 'idle' | 'initializing' | 'ready' | 'error' | 'rotating';

export interface EncryptionState {
  status: EncryptionStatus;
  activeKeyId: string | null;
  keys: EncryptionKey[];
  lastRotation: RotationResult | null;
  error: string | null;
  lastEncrypted: EncryptedPayload | null;
}

export interface EncryptionActions {
  setStatus: (status: EncryptionStatus) => void;
  setActiveKeyId: (id: string | null) => void;
  setKeys: (keys: EncryptionKey[]) => void;
  addKey: (key: EncryptionKey) => void;
  updateKey: (id: string, patch: Partial<EncryptionKey>) => void;
  setLastRotation: (result: RotationResult | null) => void;
  setError: (error: string | null) => void;
  setLastEncrypted: (payload: EncryptedPayload | null) => void;
  reset: () => void;
}

export type EncryptionStore = EncryptionState & EncryptionActions;

const INITIAL_STATE: EncryptionState = {
  status: 'idle',
  activeKeyId: null,
  keys: [],
  lastRotation: null,
  error: null,
  lastEncrypted: null,
};

function clearPersistedEncryptionStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    const keysToRemove: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith('sorotask_enc_keys')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => storage.removeItem(key));
  } catch {
    // Best-effort cleanup.
  }
}

export const useEncryptionStore = create<EncryptionStore>((set) => ({
  ...INITIAL_STATE,

  setStatus(status) {
    set((state) => {
      if (state.status === status && state.error === null) return state;
      return {
        ...state,
        status,
        error: status === 'error' ? state.error : null,
      };
    });
  },

  setActiveKeyId(id) {
    set((state) => (state.activeKeyId === id ? state : { ...state, activeKeyId: id }));
  },

  setKeys(keys) {
    set((state) => (state.keys === keys ? state : { ...state, keys }));
  },

  addKey(key) {
    set((state) => {
      const existing = state.keys.find((k) => k.id === key.id);
      if (existing && existing === key) return state;
      const nextKeys = [...state.keys.filter((k) => k.id !== key.id), key];
      return state.keys.length === nextKeys.length && state.keys.every((k, index) => k === nextKeys[index])
        ? state
        : { ...state, keys: nextKeys };
    });
  },

  updateKey(id, patch) {
    set((state) => {
      const target = state.keys.find((k) => k.id === id);
      if (!target) return state;
      const nextKey = { ...target, ...patch };
      const nextKeys = state.keys.map((k) => (k.id === id ? nextKey : k));
      return state.keys.every((k, index) => k === nextKeys[index])
        ? state
        : { ...state, keys: nextKeys };
    });
  },

  setLastRotation(result) {
    set((state) => (state.lastRotation === result ? state : { ...state, lastRotation: result }));
  },

  setError(error) {
    set((state) => {
      if (state.error === error && state.status === (error ? 'error' : 'idle')) return state;
      return { ...state, error, status: error ? 'error' : 'idle' };
    });
  },

  setLastEncrypted(payload) {
    set((state) => (state.lastEncrypted === payload ? state : { ...state, lastEncrypted: payload }));
  },

  reset() {
    clearPersistedEncryptionStorage();
    set((state) => (state.status === INITIAL_STATE.status && state.activeKeyId === INITIAL_STATE.activeKeyId && state.keys.length === 0 && state.error === null && state.lastRotation === null && state.lastEncrypted === null ? state : INITIAL_STATE));
  },
}));

// ── Selectors ─────────────────────────────────────────────────────────────────

export function selectActiveKey(state: EncryptionStore): EncryptionKey | null {
  return state.keys.find((k) => k.id === state.activeKeyId) ?? null;
}

export function selectActiveKeys(state: EncryptionStore): EncryptionKey[] {
  return state.keys.filter((k) => k.status === 'active');
}

export function selectIsReady(state: EncryptionStore): boolean {
  return state.status === 'ready' && state.activeKeyId !== null;
}
