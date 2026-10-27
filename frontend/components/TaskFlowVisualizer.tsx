"use client";

import React, { useCallback, useMemo, useRef } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnect,
} from "reactflow";
import "reactflow/dist/style.css";
import TaskNode from "./nodes/TaskNode";
import ResolverNode from "./nodes/ResolverNode";
import TargetContractNode from "./nodes/TargetContractNode";
import {
  dagToRegisterParams,
  type TaskFlowNode,
  type TaskFlowNodeData,
  type TaskNodeKind,
} from "@/lib/dagToRegisterParams";
import styles from "./TaskFlowVisualizer.module.css";

const nodeTypes = {
  task: TaskNode,
  resolver: ResolverNode,
  target: TargetContractNode,
};

let nodeCounter = 0;
function nextId(prefix: string) {
  nodeCounter += 1;
  return `${prefix}-${nodeCounter}`;
}

const NODE_KINDS: readonly TaskNodeKind[] = ["task", "resolver", "target"];

function isNodeKind(value: string): value is TaskNodeKind {
  return (NODE_KINDS as readonly string[]).includes(value);
}

export interface TaskFlowVisualizerProps {
  initialNodes?: TaskFlowNode[];
  initialEdges?: Edge[];
  onRegister?: (params: ReturnType<typeof dagToRegisterParams>) => void;
}

function FlowInner({
  initialNodes,
  initialEdges,
  onRegister,
}: TaskFlowVisualizerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNodeData>(
    initialNodes ?? [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges ?? []);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const onConnect = useCallback<OnConnect>(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.target}-${Date.now()}`,
          },
          current,
        ),
      );
    },
    [setEdges],
  );

  const addNode = useCallback(
    (kind: TaskFlowNodeData["kind"]) => {
      const id = nextId(kind);
      const label =
        kind === "task"
          ? "New Task"
          : kind === "resolver"
            ? "New Resolver"
            : "Target Contract";
      const newNode: TaskFlowNode = {
        id,
        type: kind,
        position: {
          x: 120 + Math.random() * 200,
          y: 120 + Math.random() * 200,
        },
        data: { kind, label },
      };
      setNodes((nodes) => nodes.concat(newNode));
    },
    [setNodes],
  );

  const exportParams = useCallback(() => {
    const params = dagToRegisterParams(nodes as TaskFlowNode[], edges);
    onRegister?.(params);
    return params;
  }, [nodes, edges, onRegister]);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData("application/reactflow");
      if (!isNodeKind(kind)) return;
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const id = nextId(kind);
      const label =
        kind === "task"
          ? "New Task"
          : kind === "resolver"
            ? "New Resolver"
            : "Target Contract";
      const newNode: TaskFlowNode = {
        id,
        type: kind,
        position: {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
        data: { kind, label },
      };
      setNodes((nodes) => nodes.concat(newNode));
    },
    [setNodes],
  );

  const onDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>, kind: TaskNodeKind) => {
      event.dataTransfer.setData("application/reactflow", kind);
      event.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const defaultEdgeOptions = useMemo(() => ({ animated: true }), []);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => addNode("task")}
        >
          Add Task
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => addNode("resolver")}
        >
          Add Resolver
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => addNode("target")}
        >
          Add Target Contract
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => exportParams()}
        >
          Export register() Params
        </button>
      </div>
      <div
        className={styles.canvas}
        ref={wrapperRef}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
          <Panel position="top-left">
            <div className={styles.toolbar}>
              <span
                onDragStart={(e) => onDragStart(e, "task")}
                draggable
                className={styles.toolbarButton}
              >
                Task
              </span>
              <span
                onDragStart={(e) => onDragStart(e, "resolver")}
                draggable
                className={styles.toolbarButton}
              >
                Resolver
              </span>
              <span
                onDragStart={(e) => onDragStart(e, "target")}
                draggable
                className={styles.toolbarButton}
              >
                Target
              </span>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

export default function TaskFlowVisualizer(props: TaskFlowVisualizerProps) {
  return (
    <ReactFlowProvider>
      <FlowInner {...props} />
    </ReactFlowProvider>
  );
}
