import type { TaskContent } from "@/src/types/task";

export interface TaskDraft {
  /** Mirrors the task id when editing an existing task; undefined for new drafts */
  taskId?: string;
  /** Stable client-side key for the draft itself */
  draftKey: string;
  title: string;
  description: TaskContent | null;
  savedAt: number;
}

export interface DraftStoreOptions {
  dbName?: string;
  storeName?: string;
}
