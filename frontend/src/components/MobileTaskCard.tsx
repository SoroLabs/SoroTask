"use client";

import { useRef } from "react";
import { useTaskSelection } from "@/src/hooks/useTaskSelection";

export type MobileTask = {
  id: string | number;
  target?: string;
  contract?: string;
  function?: string;
  fn?: string;
  interval?: number;
  intervalSec?: number;
  gasBalance?: number;
  gas?: number;
  status?: string;
  isActive?: boolean;
};

type MobileTaskCardProps = {
  task: MobileTask;
  busy?: boolean;
  walletConnected: boolean;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
};

const SWIPE_THRESHOLD = 72;

export default function MobileTaskCard({
  task,
  busy = false,
  walletConnected,
  onPause,
  onResume,
}: MobileTaskCardProps) {
  const pointerStart = useRef<{ id: number; x: number } | null>(null);
  const swipeHandled = useRef(false);
  const { selectTask } = useTaskSelection();
  const pauseSwipe = task.isActive === false || task.status === "pending";
  const taskId = String(task.id);

  const runSwipeAction = (direction: number) => {
    if (!walletConnected || busy) return;
    if (direction < 0 && !pauseSwipe) {
      onPause(taskId);
    } else if (direction > 0 && pauseSwipe) {
      onResume(taskId);
    } else {
      return;
    }

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(15);
    }
  };

  return (
    <article
      data-testid="mobile-task-card"
      className="overflow-hidden rounded-xl border border-neutral-700/60 bg-neutral-900/90"
    >
      <div className="touch-pan-y will-change-transform p-4">
        <div
          role="button"
          tabIndex={0}
          aria-label={`Open task ${task.id} details`}
          className="min-w-0"
          onClick={() => {
            if (swipeHandled.current) {
              swipeHandled.current = false;
              return;
            }
            selectTask(taskId);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectTask(taskId);
            }
          }}
          onPointerDown={(event) => {
            if (busy || event.pointerType === "mouse") return;
            pointerStart.current = { id: event.pointerId, x: event.clientX };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = pointerStart.current;
            if (!start || start.id !== event.pointerId) return;
            const offset = Math.max(-120, Math.min(120, event.clientX - start.x));
            event.currentTarget.style.transform = `translateX(${offset}px)`;
          }}
          onPointerUp={(event) => {
            const start = pointerStart.current;
            if (!start || start.id !== event.pointerId) return;
            const offset = event.clientX - start.x;
            pointerStart.current = null;
            event.currentTarget.style.transform = "";
            if (Math.abs(offset) >= SWIPE_THRESHOLD) {
              swipeHandled.current = true;
              runSwipeAction(offset);
            }
          }}
          onPointerCancel={(event) => {
            if (pointerStart.current?.id !== event.pointerId) return;
            pointerStart.current = null;
            event.currentTarget.style.transform = "";
          }}
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-neutral-100">
                {task.function ?? task.fn ?? `Task #${task.id}`}
              </h3>
              <p className="mt-1 truncate font-mono text-xs text-neutral-400">
                {task.target ?? task.contract ?? `Task #${task.id}`}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-neutral-700 px-2.5 py-1 text-xs capitalize text-neutral-300">
              {pauseSwipe ? "Paused" : task.status ?? "Active"}
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-neutral-500">Interval</dt>
              <dd className="truncate text-neutral-200">
                {(task.interval ?? task.intervalSec) != null
                  ? `${task.interval ?? task.intervalSec}s`
                  : "—"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-neutral-500">Gas balance</dt>
              <dd className="truncate text-neutral-200">
                {task.gasBalance ?? task.gas ?? "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => runSwipeAction(-1)}
            disabled={busy || !walletConnected || pauseSwipe}
            className="min-h-12 rounded-lg border border-amber-500/30 px-3 text-sm font-medium text-amber-200 disabled:opacity-40"
          >
            Pause
          </button>
          <button
            type="button"
            onClick={() => runSwipeAction(1)}
            disabled={busy || !walletConnected || !pauseSwipe}
            className="min-h-12 rounded-lg border border-emerald-500/30 px-3 text-sm font-medium text-emerald-200 disabled:opacity-40"
          >
            Resume
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-neutral-500">
          {walletConnected
            ? "Swipe left to pause · swipe right to resume"
            : "Connect your wallet to change task status"}
        </p>
      </div>
    </article>
  );
}
