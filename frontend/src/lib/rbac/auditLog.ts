import type { Permission } from "@/types/auth";
import type { RbacDecisionReason, TeamRole } from "./types";

/**
 * One recorded permission decision (issue #1244: "actions log user ID").
 *
 * Both allowed and denied attempts are recorded — a denied attempt is often
 * the more interesting row when reviewing who tried to delete what.
 */
export type RbacAuditEntry = {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** The user the action is attributed to. */
  userId: string;
  userName?: string;
  role?: TeamRole;
  action: string;
  permission?: Permission;
  allowed: boolean;
  reason: RbacDecisionReason;
  /** Optional target, e.g. the task id the action applied to. */
  target?: string;
  viaDelegationId?: string;
};

export type RbacAuditLogOptions = {
  /** Newest entries are kept; older ones are dropped. */
  maxEntries?: number;
  /** Injectable for deterministic timestamps in tests. */
  now?: () => number;
  /** Injectable id generator. */
  generateId?: () => string;
};

const DEFAULT_MAX_ENTRIES = 500;

function defaultId(): string {
  // Short random id is enough for a client-side log; the server keeps the
  // authoritative record.
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Bounded, in-memory audit log.
 *
 * Bounded on purpose: this runs in the browser and an unbounded array would
 * grow for the life of the tab.
 */
export function createRbacAuditLog(options: RbacAuditLogOptions = {}) {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? (() => Date.now());
  const generateId = options.generateId ?? defaultId;
  const entries: RbacAuditEntry[] = [];

  const record = (
    entry: Omit<RbacAuditEntry, "id" | "at"> & { at?: string },
  ): RbacAuditEntry => {
    const logged: RbacAuditEntry = {
      id: generateId(),
      at: entry.at ?? new Date(now()).toISOString(),
      userId: entry.userId,
      userName: entry.userName,
      role: entry.role,
      action: entry.action,
      permission: entry.permission,
      allowed: entry.allowed,
      reason: entry.reason,
      target: entry.target,
      viaDelegationId: entry.viaDelegationId,
    };

    entries.push(logged);
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
    return logged;
  };

  /** Every entry, newest first. */
  const list = (): RbacAuditEntry[] => [...entries].reverse();

  const entriesFor = (userId: string): RbacAuditEntry[] =>
    list().filter((entry) => entry.userId === userId);

  const clear = (): void => {
    entries.length = 0;
  };

  return { record, list, entriesFor, clear, size: () => entries.length };
}

export type RbacAuditLog = ReturnType<typeof createRbacAuditLog>;

let globalLog: RbacAuditLog | null = null;

/** Process-wide log, so any component can record without prop drilling. */
export function getRbacAuditLog(): RbacAuditLog {
  if (!globalLog) {
    globalLog = createRbacAuditLog();
  }
  return globalLog;
}

export function resetRbacAuditLog(): void {
  globalLog = null;
}
