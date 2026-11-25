'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from 'reactflow';
import dagre from 'dagre';

export interface TaskNodeData {
  label: string;
  status: 'pending' | 'running' | 'completed' | 'selected' | 'error';
  parentTaskIds?: string[];
  interval?: string;
  lastRun?: string;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

/**
 * Detects if adding an edge would create a cycle using DFS
 */
function wouldCreateCycle(
  edges: Edge[],
  source: string,
  target: string
): boolean {
  const adj = new Map<string, string[]>();
  edges.forEach((e) => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  });
  
  // Add the proposed edge
  if (!adj.has(source)) adj.set(source, []);
  adj.get(source)!.push(target);

  // DFS to detect cycle
  const visited = new Set<string>();
  const recStack = new Set<string>();
  
  function hasCycle(node: string): boolean {
    visited.add(node);
    recStack.add(node);
    
    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        return true;
      }
    }
    
    recStack.delete(node);
    return false;
  }

  for (const node of adj.keys()) {
    if (!visited.has(node) && hasCycle(node)) return true;
  }
  return false;
}

/**
 * Layout nodes using Dagre
 */
function getLayoutedElements(nodes: Node<TaskNodeData>[], edges: Edge[]) {
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80 });
  
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });
  
  dagre.layout(dagreGraph);
  
  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });
}

/**
 * Hook for interactive node graph editing with cycle detection
 */
export function useTaskGraphEditor(initialNodes?: Node<TaskNodeData>[], initialEdges?: Edge[]) {
  const [nodes, setNodes] = useState<Node<TaskNodeData>[]>(initialNodes || []);
  const [edges, setEdges] = useState<Edge[]>(initialEdges || []);
  const [cycleWarning, setCycleWarning] = useState<string | null>(null);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        if (wouldCreateCycle(edges, connection.source, connection.target)) {
          setCycleWarning('Warning: This connection would create a circular dependency!');
          setTimeout(() => setCycleWarning(null), 3000);
          return;
        }
        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280' },
              style: { stroke: '#6b7280' },
            },
            eds
          )
        );
      }
    },
    [edges]
  );

  const addNode = useCallback((label: string, id?: string) => {
    const newId = id || `task-${Date.now()}`;
    const newNode: Node<TaskNodeData> = {
      id: newId,
      type: 'taskNode',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: { label, status: 'pending' },
    };
    setNodes((nds) => [...nds, newNode]);
    return newId;
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }, []);

  const updateNodeData = useCallback((nodeId: string, data: Partial<TaskNodeData>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n))
    );
  }, []);

  const runLayout = useCallback(() => {
    setNodes((nds) => {
      const layouted = getLayoutedElements(nds, edges);
      return layouted;
    });
  }, [edges]);

  const parentTaskIds = useMemo(() => {
    return nodes.map((n) => n.data.parentTaskIds || []).flat();
  }, [nodes]);

  const exportJson = useCallback(() => {
    return JSON.stringify({ nodes, edges }, null, 2);
  }, [nodes, edges]);

  const importJson = useCallback((json: string) => {
    try {
      const { nodes: importedNodes, edges: importedEdges } = JSON.parse(json);
      setNodes(importedNodes);
      setEdges(importedEdges);
    } catch (e) {
      console.error('Invalid JSON:', e);
    }
  }, []);

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    removeNode,
    updateNodeData,
    runLayout,
    parentTaskIds,
    cycleWarning,
    exportJson,
    importJson,
  };
}