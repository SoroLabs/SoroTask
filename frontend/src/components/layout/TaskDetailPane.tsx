"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTask } from "@/src/hooks/tasks";
import { useLayoutStore } from "@/src/store/layoutStore";
import {
  CollaborativeProvider,
  CollaborationInfo,
  CollaborativeStatus,
  SyncStatusMessage,
  useCollaborative,
} from "@/src/lib/collaborative";
import { ExecuteTaskButton } from "@/src/components/ExecuteTaskButton";
import { useSorobanEnvironment } from "@/src/lib/soroban/useSorobanEnvironment";
import { getNetworkConfig } from "@/src/lib/network/config";
import { useWalletOptional } from "@/app/context/WalletContext";

// Simple icon components to avoid external dependencies
const XMarkIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ArrowLeftIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

interface TaskDetailPaneProps {
  taskId: string;
  onClose: () => void;
  showBackButton?: boolean;
}

export default function TaskDetailPane({
  taskId,
  onClose,
  showBackButton = false,
}: TaskDetailPaneProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { data: task, isLoading, isError } = useTask(taskId);
  const { closeDetailPane } = useLayoutStore();
  const currentUserId = useMemo(() => {
    if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
      return `user-${window.crypto.randomUUID()}`;
    }
    return `user-${taskId}`;
  }, [taskId]);

  useEffect(() => {
    if (closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [taskId]);

  useEffect(() => {
    if (isError) {
      closeDetailPane();
    }
  }, [isError, closeDetailPane]);

  return (
    <div
      role="complementary"
      aria-label="Task detail"
      className="h-full flex flex-col bg-neutral-900"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          {showBackButton && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
              aria-label="Back to list"
            >
              <ArrowLeftIcon className="w-5 h-5 text-neutral-300" />
            </button>
          )}
          <h2 className="text-lg font-semibold text-neutral-100">Task Details</h2>
        </div>
        {!showBackButton && (
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
            aria-label="Close task detail"
          >
            <XMarkIcon className="w-5 h-5 text-neutral-300" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isLoading && (
          <div className="space-y-4">
            <div className="h-8 bg-neutral-800 rounded animate-pulse" />
            <div className="h-4 bg-neutral-800 rounded animate-pulse w-3/4" />
            <div className="h-4 bg-neutral-800 rounded animate-pulse w-1/2" />
            <div className="space-y-2 mt-6">
              <div className="h-4 bg-neutral-800 rounded animate-pulse" />
              <div className="h-4 bg-neutral-800 rounded animate-pulse" />
              <div className="h-4 bg-neutral-800 rounded animate-pulse w-5/6" />
            </div>
          </div>
        )}

        {task && (
          <CollaborativeProvider
            taskId={task.id}
            userId={currentUserId}
            userName="You"
            serverUrl={typeof window !== "undefined" ? window.location.origin : "ws://localhost:1234"}
            task={task as any}
            autoConnect
          >
            <TaskEditorContent task={task} />
          </CollaborativeProvider>
        )}
      </div>
    </div>
  );
}

function TaskEditorContent({ task }: { task: any }) {
  const [title, setTitle] = useState(getTaskTitle(task));
  const [description, setDescription] = useState(getTaskDescription(task));
  const { state, updateField, getField, crdt, connect } = useCollaborative();
  const { network } = useSorobanEnvironment();
  const wallet = useWalletOptional();
  const networkConfig = getNetworkConfig(network);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    const nextTitle = getTaskTitle(task);
    const nextDescription = getTaskDescription(task);
    setTitle(nextTitle);
    setDescription(nextDescription);
  }, [task]);

  useEffect(() => {
    if (!crdt) return;

    const unsubscribe = crdt.on("operation", (event) => {
      const operation = event.data;
      if (!operation?.path) return;

      const operationPath = operation.path as string[];
      if (operationPath[0] === "title") {
        setTitle(getField(["title"]) ?? "");
      }
      if (operationPath[0] === "description") {
        setDescription(getField(["description"]) ?? "");
      }
    });

    return unsubscribe;
  }, [crdt, getField]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    updateField(["title"], value);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    updateField(["description"], value);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CollaborativeStatus />
            <span className="text-xs text-neutral-400">
              {state?.connectionStatus === "connected"
                ? "Live collaboration active"
                : "Realtime sync is warming up"}
            </span>
          </div>
          <p className="text-sm text-neutral-400">
            Local edits stay available even when the collaborative channel is unavailable.
          </p>
        </div>
        <div className="text-xs text-neutral-500">
          {state?.errorMessage ? state.errorMessage : "Changes are shared automatically"}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-5 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-semibold text-neutral-300" htmlFor="task-title">
            Task title
          </label>
          <input
            id="task-title"
            value={title}
            onChange={(event) => handleTitleChange(event.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none ring-0 focus:border-blue-500"
            placeholder="Describe the task in a few words"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-neutral-300" htmlFor="task-description">
            Task description
          </label>
          <textarea
            id="task-description"
            value={description}
            onChange={(event) => handleDescriptionChange(event.target.value)}
            rows={8}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            placeholder="Add the operational context and expected behavior"
          />
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Collaboration
          </h3>
          <CollaborationInfo />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Status</div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-neutral-100">{getTaskStatus(task)}</span>
              <ExecuteTaskButton
                taskId={task.id}
                contractId={networkConfig.contractId}
                userAddress={wallet?.session?.address}
                network={network === "mainnet" ? "public" : "testnet"}
                rpcUrl={networkConfig.rpcUrl}
              />
            </div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Updated</div>
            <div className="mt-2 text-sm font-medium text-neutral-100">
              {task.updatedAt ? new Date(task.updatedAt).toLocaleString() : "Just now"}
            </div>
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/70 p-4 text-sm text-neutral-400">
          <div className="flex justify-between">
            <span>Contract</span>
            <span className="font-mono text-neutral-100">{task.contract ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Function</span>
            <span className="font-mono text-neutral-100">{task.fn ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Interval</span>
            <span className="text-neutral-100">{task.intervalSec ? `${task.intervalSec}s` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Gas</span>
            <span className="text-neutral-100">{task.gas ?? "—"}</span>
          </div>
        </div>
      </div>

      <SyncStatusMessage />
    </div>
  );
}

function getTaskTitle(task: any): string {
  return task?.title ?? task?.fn ?? task?.contract ?? "Untitled task";
}

function getTaskDescription(task: any): string {
  if (typeof task?.description === "string") return task.description;
  if (task?.description && typeof task.description === "object") {
    return task.description.content?.map((node: any) => node.content?.map((child: any) => child.text ?? "").join("")).join("\n") ?? "";
  }
  return "";
}

function getTaskStatus(task: any): string {
  if (task.status) {
    return task.status.charAt(0).toUpperCase() + task.status.slice(1);
  }
  return "Active";
}
