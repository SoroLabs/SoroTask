/**
 * Offline task-configuration store (#1240).
 *
 * Draft configurations live in IndexedDB so a task created on a flaky
 * connection is not lost, and the pending set can be replayed the moment
 * connectivity returns. The connection plumbing lives in `./db`.
 */

import { CONFIG_STORE, getAll, getOne, runStore } from "./db";

export interface TaskConfig {
  id: string;
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
  updatedAt: number;
}

export type SyncState = "pending" | "synced";

export interface StoredTaskConfig extends TaskConfig {
  syncState: SyncState;
}

export interface SyncResult {
  synced: number;
  failed: number;
}

export async function saveTaskConfig(
  config: TaskConfig,
): Promise<StoredTaskConfig> {
  const record: StoredTaskConfig = { ...config, syncState: "pending" };
  await runStore("readwrite", CONFIG_STORE, (store) => store.put(record));
  return record;
}

export function getTaskConfig(
  id: string,
): Promise<StoredTaskConfig | undefined> {
  return getOne<StoredTaskConfig>(CONFIG_STORE, id);
}

export async function getAllTaskConfigs(): Promise<StoredTaskConfig[]> {
  return getAll<StoredTaskConfig>(CONFIG_STORE);
}

export async function getPendingConfigs(): Promise<StoredTaskConfig[]> {
  return (
    (await runStore<StoredTaskConfig[]>("readonly", CONFIG_STORE, (store) =>
      store.index("syncState").getAll("pending"),
    )) ?? []
  );
}

export async function markConfigSynced(id: string): Promise<void> {
  const existing = await getTaskConfig(id);
  if (!existing) return;
  await runStore("readwrite", CONFIG_STORE, (store) =>
    store.put({ ...existing, syncState: "synced" }),
  );
}

export async function deleteTaskConfig(id: string): Promise<void> {
  await runStore("readwrite", CONFIG_STORE, (store) => store.delete(id));
}

function toConfig(stored: StoredTaskConfig): TaskConfig {
  return {
    id: stored.id,
    contractAddress: stored.contractAddress,
    functionName: stored.functionName,
    interval: stored.interval,
    gasBalance: stored.gasBalance,
    updatedAt: stored.updatedAt,
  };
}

// Flush every pending config through `push`. Each item is independent: a
// failure leaves that config pending for the next attempt and does not abort
// the rest of the batch.
export async function syncTaskConfigs(
  push: (config: TaskConfig) => Promise<void>,
): Promise<SyncResult> {
  const pending = await getPendingConfigs();
  let synced = 0;
  let failed = 0;

  for (const config of pending) {
    try {
      await push(toConfig(config));
      await markConfigSynced(config.id);
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}
