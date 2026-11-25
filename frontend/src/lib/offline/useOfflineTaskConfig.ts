"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnlineStatus } from "../network/useOnlineStatus";
import {
  getAllTaskConfigs,
  saveTaskConfig,
  syncTaskConfigs,
  type StoredTaskConfig,
  type TaskConfig,
} from "./taskConfigDb";

export interface UseOfflineTaskConfig {
  configs: StoredTaskConfig[];
  pendingCount: number;
  online: boolean;
  syncing: boolean;
  saveConfig: (config: TaskConfig) => Promise<void>;
  sync: () => Promise<void>;
}

// Persists task configs to IndexedDB so they survive offline, and flushes them
// through `push` whenever connectivity is (re)established.
export function useOfflineTaskConfig(
  push: (config: TaskConfig) => Promise<void>,
): UseOfflineTaskConfig {
  const { online } = useOnlineStatus();
  const [configs, setConfigs] = useState<StoredTaskConfig[]>([]);
  const [syncing, setSyncing] = useState(false);

  const pushRef = useRef(push);
  pushRef.current = push;

  const refresh = useCallback(async () => {
    setConfigs(await getAllTaskConfigs());
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncTaskConfigs((config) => pushRef.current(config));
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const saveConfig = useCallback(
    async (config: TaskConfig) => {
      await saveTaskConfig(config);
      await refresh();
      if (online) await sync();
    },
    [refresh, sync, online],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  const pendingCount = configs.filter((c) => c.syncState === "pending").length;

  return { configs, pendingCount, online, syncing, saveConfig, sync };
}
