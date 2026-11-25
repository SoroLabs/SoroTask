/**
 * Offline-first surface area (#1240).
 *
 * Re-exported so consumers import from `@/src/lib/offline` rather than reaching
 * into individual store modules.
 */

export {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  CONFIG_STORE,
  TASK_STATE_STORE,
  DRAFT_STORE,
  isIndexedDbAvailable,
  openOfflineDb,
} from "./db";

export {
  saveTaskConfig,
  getTaskConfig,
  getAllTaskConfigs,
  getPendingConfigs,
  markConfigSynced,
  deleteTaskConfig,
  syncTaskConfigs,
  type TaskConfig,
  type StoredTaskConfig,
  type SyncState,
  type SyncResult,
} from "./taskConfigDb";

export {
  cacheTasks,
  getCachedTasks,
  getCachedTask,
  readSnapshot,
  clearCachedTasks,
  EMPTY_SNAPSHOT,
  type CachedTask,
  type CachedTaskSnapshot,
} from "./taskStateCache";

export {
  runSync,
  startAutoSync,
  requestBackgroundSync,
  getSyncStatus,
  subscribeToSyncStatus,
  SYNC_TAG,
  type SyncPhase,
  type SyncStatus,
} from "./backgroundSync";

export {
  OfflineSyncProvider,
  useOfflineSync,
  type OfflineSyncContextValue,
  type OfflineSyncProviderProps,
} from "./OfflineSyncProvider";

export {
  useOfflineTaskConfig,
  type UseOfflineTaskConfig,
} from "./useOfflineTaskConfig";
