'use client';

import React, { useCallback, useState, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  type Node,
  type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useTaskGraphEditor, type TaskNodeData } from '@/hooks/useTaskGraphEditor';
import { TaskNode } from '@/src/components/graph/TaskNode';

const nodeTypes = { taskNode: TaskNode };

interface TaskGraphEditorProps {
  initialNodes?: Node<TaskNodeData>[];
  initialEdges?: Edge[];
  onSave?: (nodes: Node<TaskNodeData>[], edges: Edge[]) => void;
  readOnly?: boolean;
}

export function TaskGraphEditor({
  initialNodes,
  initialEdges,
  onSave,
  readOnly = false,
}: TaskGraphEditorProps) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    cycleWarning,
    exportJson,
    importJson,
    runLayout,
  } = useTaskGraphEditor(initialNodes, initialEdges);

  const [newTaskLabel, setNewTaskLabel] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddNode = () => {
    if (newTaskLabel.trim()) {
      addNode(newTaskLabel.trim());
      setNewTaskLabel('');
    }
  };

  const handleExport = () => {
    const json = exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'task-graph.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => importJson(evt.target?.result as string);
      reader.readAsText(file);
    }
  };

  return (
    <div className="w-full h-[600px] bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
      {cycleWarning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-600 text-white px-4 py-2 rounded-lg">
          {cycleWarning}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="#374151" gap={16} />
        <Controls />
        <MiniMap nodeColor={() => '#3b82f6'} />
        <Panel position="top-left">
          {!readOnly && (
            <div className="flex gap-2 bg-slate-800 p-2 rounded-lg">
              <input
                type="text"
                value={newTaskLabel}
                onChange={(e) => setNewTaskLabel(e.target.value)}
                placeholder="Task name"
                className="bg-slate-700 text-slate-100 px-3 py-1 rounded text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleAddNode()}
              />
              <button onClick={handleAddNode} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">
                Add
              </button>
            </div>
          )}
        </Panel>
        <Panel position="top-right">
          <div className="flex gap-2 bg-slate-800 p-2 rounded-lg">
            <button onClick={runLayout} className="bg-emerald-600 text-white px-3 py-1 rounded text-sm">
              Auto Layout
            </button>
            <button onClick={handleExport} className="bg-slate-600 text-white px-3 py-1 rounded text-sm">
              Export
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="bg-slate-600 text-white px-3 py-1 rounded text-sm">
              Import
            </button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
            {onSave && (
              <button onClick={() => onSave(nodes, edges)} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">
                Save
              </button>
            )}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}