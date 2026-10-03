/**
 * Soroban RPC Task Event Subscription
 *
 * Soroban RPC does not support server-push subscriptions, so this polls
 * `getEvents` on a short interval and re-emits contract events as a
 * subscription-shaped stream (`on('event', ...)`), using the RPC's
 * pagination cursor so each poll only fetches events new since the last one.
 */

import * as rpc from "@stellar/stellar-sdk/rpc";
import { scValToNative } from "@stellar/stellar-sdk";
import { EventEmitter } from "eventemitter3";
import { createLogger } from "@/src/lib/logger";
import type {
  TaskChainEvent,
  TaskChainEventType,
  TaskEventSubscriptionOptions,
} from "@/src/types/sorobanEvents";

const logger = createLogger("soroban-task-event-subscription");

const DEFAULT_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://rpc-futurenet.stellar.org";
const DEFAULT_POLL_INTERVAL_MS = 4000;

// Contract event topics are expected to follow the convention
// `[Symbol(event_name), <task id>, ...]`. Unrecognized names surface as
// "unknown" rather than being dropped, so new contract events remain visible.
const EVENT_NAME_MAP: Record<string, TaskChainEventType> = {
  task_executed: "task_executed",
  execute_task: "task_executed",
  execution_success: "task_executed",
  task_execution_failed: "task_execution_failed",
  execution_failed: "task_execution_failed",
  task_updated: "task_updated",
  update_task: "task_updated",
  task_paused: "task_paused",
  pause_task: "task_paused",
  task_resumed: "task_resumed",
  resume_task: "task_resumed",
  task_cancelled: "task_cancelled",
  cancel_task: "task_cancelled",
};

function decodeEventName(raw: unknown): TaskChainEventType {
  if (typeof raw !== "string") return "unknown";
  return EVENT_NAME_MAP[raw] ?? "unknown";
}

function decodeTaskId(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "bigint") return raw.toString();
  if (typeof raw === "number") return raw.toString();
  if (typeof raw === "string") return raw;
  return "";
}

export function parseTaskChainEvent(
  event: rpc.Api.EventResponse,
): TaskChainEvent | null {
  try {
    const topics = (event.topic ?? []).map((scVal) => scValToNative(scVal));
    const eventType = decodeEventName(topics[0]);
    const taskId = decodeTaskId(topics[1]);
    if (!taskId) return null;

    let payload: Record<string, unknown> | undefined;
    try {
      const decodedValue = scValToNative(event.value);
      payload =
        decodedValue && typeof decodedValue === "object"
          ? (decodedValue as Record<string, unknown>)
          : { value: decodedValue };
    } catch {
      payload = undefined;
    }

    return {
      taskId,
      eventType,
      txHash: event.txHash,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
      inSuccessfulContractCall: event.inSuccessfulContractCall,
      payload,
      observedAt: Date.now(),
    };
  } catch (error) {
    logger.warn("Failed to decode contract event", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface SorobanTaskEventSubscriptionEvents {
  event: (event: TaskChainEvent) => void;
  error: (error: Error) => void;
}

/**
 * Polls a single contract for task-related events and re-emits them.
 * One instance is shared per contract (see `getTaskEventSubscription`) so
 * multiple hook consumers don't each open their own poll loop.
 */
export class SorobanTaskEventSubscription extends EventEmitter<SorobanTaskEventSubscriptionEvents> {
  private readonly server: rpc.Server;
  private readonly contractId: string;
  private readonly pollIntervalMs: number;
  private cursor: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private refCount = 0;

  constructor(options: TaskEventSubscriptionOptions) {
    super();
    this.contractId = options.contractId;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.server = new rpc.Server(options.rpcUrl ?? DEFAULT_RPC_URL);
  }

  /** Increments the consumer count and starts polling if this is the first consumer. */
  acquire(): void {
    this.refCount += 1;
    if (this.refCount === 1) {
      this.startPolling();
    }
  }

  /** Decrements the consumer count and stops polling once nobody is listening. */
  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      this.stopPolling();
    }
  }

  private startPolling(): void {
    if (this.timer) return;
    this.scheduleNext(0);
  }

  private stopPolling(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.cursor = null;
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    if (this.polling) {
      this.scheduleNext(this.pollIntervalMs);
      return;
    }
    this.polling = true;

    try {
      const request: rpc.Api.GetEventsRequest = this.cursor
        ? {
            filters: [{ type: "contract", contractIds: [this.contractId] }],
            cursor: this.cursor,
          }
        : {
            filters: [{ type: "contract", contractIds: [this.contractId] }],
            startLedger: await this.resolveStartLedger(),
          };

      const response = await this.server.getEvents(request);
      this.cursor = response.cursor;

      for (const rawEvent of response.events) {
        const parsed = parseTaskChainEvent(rawEvent);
        if (parsed) {
          this.emit("event", parsed);
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn("Task event poll failed, will retry", { error: err.message });
      this.emit("error", err);
    } finally {
      this.polling = false;
      if (this.refCount > 0) {
        this.scheduleNext(this.pollIntervalMs);
      }
    }
  }

  private async resolveStartLedger(): Promise<number> {
    const latest = await this.server.getLatestLedger();
    // Soroban RPC only retains a recent window of events; starting a few
    // ledgers back covers events emitted just before the subscription opened
    // without re-scanning the whole retention window.
    return Math.max(1, latest.sequence - 5);
  }
}

const subscriptions = new Map<string, SorobanTaskEventSubscription>();

/** Returns the shared subscription for a contract, creating it on first use. */
export function getTaskEventSubscription(
  options: TaskEventSubscriptionOptions,
): SorobanTaskEventSubscription {
  const key = `${options.rpcUrl ?? DEFAULT_RPC_URL}:${options.contractId}`;
  let subscription = subscriptions.get(key);
  if (!subscription) {
    subscription = new SorobanTaskEventSubscription(options);
    subscriptions.set(key, subscription);
  }
  return subscription;
}
