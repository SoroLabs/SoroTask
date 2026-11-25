import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { truncateLabel } from "@/src/lib/graphUtils";

export type TaskNodeStatus = "selected" | "has_run" | "pending";

export interface TaskNodeData {
  label: string;
  status: TaskNodeStatus;
}

export const TASK_NODE_WIDTH = 180;

const STATUS_DOT: Record<TaskNodeStatus, string> = {
  selected: "bg-blue-500",
  has_run: "bg-green-500",
  pending: "bg-yellow-500",
};

const STATUS_LABEL: Record<TaskNodeStatus, string> = {
  selected: "Selected",
  has_run: "Has run",
  pending: "Pending",
};

function TaskNodeComponent({ id, data, selected }: NodeProps<TaskNodeData>) {
  const status: TaskNodeStatus = selected ? "selected" : data.status;

  return (
    <div
      data-testid={`task-node-${id}`}
      style={{ width: TASK_NODE_WIDTH }}
      className={`rounded-lg border px-3 py-2 shadow-sm transition-colors ${
        status === "selected"
          ? "border-blue-500 bg-blue-600 text-white"
          : "border-neutral-700 bg-neutral-900 text-neutral-100"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-neutral-500" />
      <div className="flex items-center gap-2">
        <span
          data-testid={`task-node-status-${id}`}
          aria-label={STATUS_LABEL[status]}
          title={STATUS_LABEL[status]}
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
        />
        <span className="truncate text-sm font-medium" title={data.label}>
          {truncateLabel(data.label, 24)}
        </span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-neutral-400">{id}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-neutral-500"
      />
    </div>
  );
}

export const TaskNode = memo(TaskNodeComponent);

export const nodeTypes = { taskNode: TaskNode };
