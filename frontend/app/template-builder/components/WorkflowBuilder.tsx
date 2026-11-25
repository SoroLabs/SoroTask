/**
 * WorkflowBuilder.tsx — Visual drag-and-drop workflow builder (issue #1478 [FE-PROD-04]).
 *
 * Provides: palette of triggers/actions, draggable node placement, port-to-port
 * bezier connectors, inline parameter editing, validation that catches missing
 * inputs, and compilation into valid Soroban contract call payloads.
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { ActionBlock, ActionDefinition, FlowTemplate, AbiParam } from '../types';
import { PREDEFINED_ACTIONS } from '../actions';
import { useTemplateBuilder } from '../useTemplateBuilder';

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'action';
  definitionId?: string;
  label: string;
  icon: string;
  top: number;
  left: number;
  inputs: AbiParam[];
  args: Record<string, string>;
  isConfigured: boolean;
}

export interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toPort: string;
  label?: string;
}

interface WorkflowBuilderProps {
  onCompile?: (payload: CompiledPipeline) => void;
  className?: string;
}

export interface CompiledPipeline {
  templateId: string;
  name: string;
  edges: CompiledEdge[];
  blocks: CompiledBlock[];
  valid: boolean;
  validationErrors: string[];
}

export interface CompiledEdge {
  from: string;
  to: string;
  id: string;
  label?: string;
}

export interface CompiledBlock {
  instanceId: string;
  kind: 'trigger' | 'action';
  contractAddress: string;
  functionName: string;
  args: Record<string, unknown>;
  missing: string[];
}

const PALETTE_ITEMS: Array<{ kind: 'trigger' | 'action'; def: ActionDefinition }> = [
  { kind: 'trigger', def: PREDEFINED_ACTIONS[0] },
  ...PREDEFINED_ACTIONS.map((def) => ({ kind: 'action', def })),
];

function useDragState() {
  const [dragging, setDragging] = useState<{ item: WorkflowNode; origin: 'palette' | 'canvas'; startX: number; startY: number } | null>(null);
  const [overNode, setOverNode] = useState<string | null>(null);
  return { dragging, setDragging, setOverNode, overNode };
}

function bezierPath(x1: number, y1: number, x2: number, y2: number, curvature: number = 0.5): string {
  const dx = Math.abs(x2 - x1);
  const cp = Math.max(60, dx * curvature);
  return `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${x2 - cp} ${y2}, ${x2} ${y2}`;
}

function portPosition(node: WorkflowNode, port: 'out' | 'in', nodes: WorkflowNode[], edges: WorkflowEdge[]): { x: number; y: number } {
  const base = nodes.find((n) => n.id === node.id);
  if (!base) return { x: node.left, y: node.top };
  const w = 180;
  const h = 220;
  if (port === 'out') {
    const target = edges.find((e) => e.fromNodeId === node.id);
    if (target) {
      const t = nodes.find((n) => n.id === target.toNodeId);
      if (t) {
        return { x: base.left + w / 2, y: base.top + h };
      }
    }
    return { x: base.left + w / 2, y: base.top + h };
  }
  return { x: base.left, y: base.top + 40 };
}

function nodeColorForKind(kind: 'trigger' | 'action'): string {
  return kind === 'trigger' ? 'bg-indigo-500' : 'bg-emerald-500';
}

function nodeBorderForKind(kind: 'trigger' | 'action'): string {
  return kind === 'trigger' ? 'border-indigo-400' : 'border-emerald-400';
}

function nodeRingForKind(kind: 'trigger' | 'action'): string {
  return kind === 'trigger' ? 'ring-indigo-400' : 'ring-emerald-400';
}

function buildInitialNodes(): WorkflowNode[] {
  return [
    {
      id: 'start',
      type: 'trigger',
      label: 'Schedule Trigger',
      icon: '⏰',
      top: 60,
      left: 60,
      inputs: [],
      args: { cron: '0 8 * * 1' },
      isConfigured: true,
    },
  ];
}

export function WorkflowBuilder({ onCompile, className = '' }: WorkflowBuilderProps) {
  const builder = useTemplateBuilder();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>(buildInitialNodes);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [dragging, setDragging, setOverNode, overNode] = useDragState();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ fromNodeId: string; fromPort: string; fromX: number; fromY: number } | null>(null);
  const [compiled, setCompiled] = useState<CompiledPipeline | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);

  const allBlocks = useMemo(() => {
    return builder.blocks.map((block) => {
      const node = nodes.find((n) => n.id === block.instanceId);
      return {
        ...block,
        node,
      };
    });
  }, [builder.blocks, nodes]);

  const paletteItems = useMemo(() => PALETTE_ITEMS, []);

  const addNode = useCallback((def: ActionDefinition, kind: 'trigger' | 'action', x: number, y: number) => {
    const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inputs = def.inputs.slice();
    const block: ActionBlock = {
      instanceId: id,
      definitionId: def.id,
      label: def.label,
      category: def.category,
      icon: def.icon,
      contractAddress: def.defaultContractAddress ?? '',
      functionName: def.functionName,
      inputs,
      args: {},
      isConfigured: inputs.filter((p) => !p.optional).length === 0,
    };
    builder.addBlock(block);
    setNodes((prev) => [...prev, { id, type: kind, definitionId: def.id, label: def.label, icon: def.icon, top: y, left: x, inputs, args: {}, isConfigured: block.isConfigured }]);
    setSelectedNodeId(id);
  }, [builder]);

  const removeNode = useCallback((nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId));
    builder.removeBlock(nodeId);
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
  }, [builder]);

  const updateNodeArg = useCallback((nodeId: string, paramName: string, value: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setNodes((prev) => prev.map((n) => {
      if (n.id !== nodeId) return n;
      const args = { ...n.args, [paramName]: value };
      const inputs = n.inputs;
      const missing = inputs.filter((p) => !p.optional && !args[p.name]?.trim()).map((p) => p.name);
      return {
        ...n,
        args,
        isConfigured: missing.length === 0,
      };
    }));
    builder.updateArg(nodeId, paramName, value);
  }, [nodes, builder]);

  const onDragStartPalette = useCallback((ev: React.DragEvent, item: { kind: 'trigger' | 'action'; def: ActionDefinition }) => {
    ev.dataTransfer.setData('application/json', JSON.stringify({ kind: item.kind, definitionId: item.def.id, label: item.def.label, icon: item.def.icon, inputs: item.def.inputs }));
    ev.dataTransfer.effectAllowed = 'copy';
    setDragging({ item: { id: `palette-${Date.now()}`, type: item.kind, label: item.def.label, icon: item.def.icon, top: 0, left: 0, inputs: item.def.inputs, args: {}, isConfigured: false }, origin: 'palette', startX: ev.clientX, startY: ev.clientY });
  }, []);

  const onDragStartCanvas = useCallback((ev: React.DragEvent, nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    ev.stopPropagation();
    ev.dataTransfer.setData('text/plain', nodeId);
    ev.dataTransfer.effectAllowed = 'move';
    setDragging({ item: { ...node, top: ev.clientY - dragOffset.y, left: ev.clientX - dragOffset.x }, origin: 'canvas', startX: ev.clientX, startY: ev.clientY });
  }, [nodes, dragOffset]);

  const onDragEnd = useCallback(() => {
    setDragging(null);
    setOverNode(null);
  }, []);

  const onDragOverCanvas = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = dragging?.origin === 'palette' ? 'copy' : 'move';
    if (dragging?.origin === 'palette') {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = ev.clientX - rect.left - 90;
        const y = ev.clientY - rect.top - 60;
        setDragOffset({ x: ev.clientX - rect.left - 90, y: ev.clientY - rect.top - 60 });
      }
    } else if (dragging?.origin === 'canvas' && overNode === null) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = ev.clientX - rect.left - 90;
        const y = ev.clientY - rect.top - 60;
        setNodes((prev) => prev.map((n) => n.id === dragging.item.id ? { ...n, top: ev.clientY - rect.top - 60, left: ev.clientX - rect.left - 90 } : n));
        setDragOffset({ x: ev.clientX - rect.left - 90, y: ev.clientY - rect.top - 60 });
      }
    }
  }, [dragging, overNode]);

  const onDropCanvas = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const payload = ev.dataTransfer.getData('application/json');
    if (payload) {
      const { kind, definitionId, label, icon, inputs } = JSON.parse(payload) as { kind: 'trigger' | 'action'; definitionId: string; label: string; icon: string; inputs: AbiParam[] };
      const x = ev.clientX - rect.left - 90;
      const y = ev.clientY - rect.top - 60;
      if (kind === 'trigger') {
        addNode({ id: definitionId, label, description: '', category: 'defi', icon, functionName: 'trigger', inputs, defaultContractAddress: '' } as ActionDefinition, kind, x, y);
      } else {
        const def = PREDEFINED_ACTIONS.find((a) => a.id === definitionId);
        if (def) addNode(def, kind, x, y);
      }
    } else {
      const nodeId = ev.dataTransfer.getData('text/plain');
      if (nodeId) {
        const node = nodes.find((n) => n.id === nodeId);
        if (node) {
          setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, top: ev.clientY - rect.top - 60, left: ev.clientX - rect.left - 90 } : n));
        }
      }
    }
    setDragging(null);
    setOverNode(null);
  }, [addNode, nodes]);

  const onMouseDownNode = useCallback((ev: React.MouseEvent, nodeId: string, x: number, y: number) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if ((ev.target as HTMLElement).closest('[data-handle]')) {
      ev.stopPropagation();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        setConnecting({ fromNodeId: nodeId, fromPort: 'out', fromX: ev.clientX - rect.left, fromY: ev.clientY - rect.top });
      }
      return;
    }
    setSelectedNodeId(nodeId);
    setDragOffset({ x: ev.clientX - node.left - 90, y: ev.clientY - node.top - 60 });
    setDragging({ item: { ...node, top: node.top, left: node.left }, origin: 'canvas', startX: ev.clientX, startY: ev.clientY });
  }, [nodes]);

  const onMouseMoveCanvas = useCallback((ev: React.MouseEvent) => {
    if (!dragging || dragging.origin !== 'canvas') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setNodes((prev) => prev.map((n) => n.id === dragging.item.id ? { ...n, top: ev.clientY - rect.top - 60, left: ev.clientX - rect.left - 90 } : n));
  }, [dragging]);

  const onMouseUpCanvas = useCallback(() => {
    setDragging(null);
  }, []);

  const onMouseMoveDocument = useCallback((ev: MouseEvent) => {
    if (!connecting) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnecting((prev) => prev ? { ...prev, fromX: ev.clientX - rect.left, fromY: ev.clientY - rect.top } : null);
  }, [connecting]);

  const onMouseUpDocument = useCallback((ev: MouseEvent) => {
    if (!connecting) return;
    const target = (ev.target as HTMLElement).closest('[data-port="in"]');
    if (target) {
      const toNodeId = target.getAttribute('data-node-id');
      if (toNodeId && toNodeId !== connecting.fromNodeId) {
        const id = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setEdges((prev) => [...prev, { id, fromNodeId: connecting.fromNodeId, fromPort: connecting.fromPort, toNodeId, toPort: 'in', label: 'executes' }]);
      }
    }
    setConnecting(null);
  }, [connecting]);

  useEffect(() => {
    if (connecting) {
      document.addEventListener('mousemove', onMouseMoveDocument);
      document.addEventListener('mouseup', onMouseUpDocument);
      return () => {
        document.removeEventListener('mousemove', onMouseMoveDocument);
        document.removeEventListener('mouseup', onMouseUpDocument);
      };
    }
  }, [connecting, onMouseMoveDocument, onMouseUpDocument]);

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      if (dragging?.origin === 'canvas') {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          setNodes((prev) => prev.map((n) => n.id === dragging.item.id ? { ...n, top: ev.clientY - rect.top - 60, left: ev.clientX - rect.left - 90 } : n));
        }
      }
    };
    if (dragging?.origin === 'canvas') {
      document.addEventListener('mousemove', handler);
      document.addEventListener('mouseup', onMouseUpCanvas);
      return () => {
        document.removeEventListener('mousemove', handler);
        document.removeEventListener('mouseup', onMouseUpCanvas);
      };
    }
  }, [dragging, onMouseUpCanvas]);

  const handleDragStartCanvasRef = useCallback((ev: React.DragEvent, nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    ev.stopPropagation();
    ev.dataTransfer.setData('text/plain', nodeId);
    ev.dataTransfer.effectAllowed = 'move';
    setDragOffset({ x: ev.clientX - node.left - 90, y: ev.clientY - node.top - 60 });
    setDragging({ item: { ...node, top: ev.clientY - dragOffset.y, left: ev.clientX - dragOffset.x }, origin: 'canvas', startX: ev.clientX, startY: ev.clientY });
  }, [nodes, dragOffset]);

  const handleDragOverCanvasRef = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = dragging?.origin === 'palette' ? 'copy' : 'move';
    if (dragging?.origin === 'palette') {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        setDragOffset({ x: ev.clientX - rect.left - 90, y: ev.clientY - rect.top - 60 });
      }
    } else if (dragging?.origin === 'canvas' && overNode === null) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        setNodes((prev) => prev.map((n) => n.id === dragging.item.id ? { ...n, top: ev.clientY - rect.top - 60, left: ev.clientX - rect.left - 90 } : n));
        setDragOffset({ x: ev.clientX - rect.left - 90, y: ev.clientY - rect.top - 60 });
      }
    }
  }, [dragging, overNode]);

  const handleDropCanvasRef = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const payload = ev.dataTransfer.getData('application/json');
    if (payload) {
      const { kind, definitionId, label, icon, inputs } = JSON.parse(payload) as { kind: 'trigger' | 'action'; definitionId: string; label: string; icon: string; inputs: AbiParam[] };
      const x = ev.clientX - rect.left - 90;
      const y = ev.clientY - rect.top - 60;
      if (kind === 'trigger') {
        addNode({ id: definitionId, label, description: '', category: 'defi', icon, functionName: 'trigger', inputs, defaultContractAddress: '' } as ActionDefinition, kind, x, y);
      } else {
        const def = PREDEFINED_ACTIONS.find((a) => a.id === definitionId);
        if (def) addNode(def, kind, x, y);
      }
    } else {
      const nodeId = ev.dataTransfer.getData('text/plain');
      if (nodeId) {
        const node = nodes.find((n) => n.id === nodeId);
        if (node) {
          setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, top: ev.clientY - rect.top - 60, left: ev.clientX - rect.left - 90 } : n));
        }
      }
    }
    setDragging(null);
    setOverNode(null);
  }, [addNode, nodes]);

  const handleDragEndRef = useCallback(() => {
    setDragging(null);
    setOverNode(null);
  }, []);

  const handleMouseDownNodeRef = useCallback((ev: React.MouseEvent, nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if ((ev.target as HTMLElement).closest('[data-handle]')) {
      ev.stopPropagation();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        setConnecting({ fromNodeId: nodeId, fromPort: 'out', fromX: ev.clientX - rect.left, fromY: ev.clientY - rect.top });
      }
      return;
    }
    setSelectedNodeId(nodeId);
    setDragOffset({ x: ev.clientX - node.left - 90, y: ev.clientY - node.top - 60 });
    setDragging({ item: { ...node, top: node.top, left: node.left }, origin: 'canvas', startX: ev.clientX, startY: ev.clientY });
  }, [nodes]);

  const handleMouseMoveCanvasRef = useCallback((ev: React.MouseEvent) => {
    if (!dragging || dragging.origin !== 'canvas') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setNodes((prev) => prev.map((n) => n.id === dragging.item.id ? { ...n, top: ev.clientY - rect.top - 60, left: ev.clientX - rect.left - 90 } : n));
  }, [dragging]);

  const handleMouseUpCanvasRef = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      if (dragging?.origin === 'canvas') {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          setNodes((prev) => prev.map((n) => n.id === dragging.item.id ? { ...n, top: ev.clientY - rect.top - 60, left: ev.clientX - rect.left - 90 } : n));
        }
      }
    };
    if (dragging?.origin === 'canvas') {
      document.addEventListener('mousemove', handler);
      document.addEventListener('mouseup', handleMouseUpCanvasRef);
      return () => {
        document.removeEventListener('mousemove', handler);
        document.removeEventListener('mouseup', handleMouseUpCanvasRef);
      };
    }
  }, [dragging, handleMouseUpCanvasRef]);

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      if (connecting) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          setConnecting((prev) => prev ? { ...prev, fromX: ev.clientX - rect.left, fromY: ev.clientY - rect.top } : null);
        }
      }
    };
    document.addEventListener('mousemove', handler);
    document.addEventListener('mouseup', (ev) => {
      if (!connecting) return;
      const target = (ev.target as HTMLElement).closest('[data-port="in"]');
      if (target) {
        const toNodeId = target.getAttribute('data-node-id');
        if (toNodeId && toNodeId !== connecting.fromNodeId) {
          const id = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          setEdges((prev) => [...prev, { id, fromNodeId: connecting.fromNodeId, fromPort: connecting.fromPort, toNodeId, toPort: 'in', label: 'executes' }]);
        }
      }
      setConnecting(null);
    });
    return () => {
      document.removeEventListener('mousemove', handler);
    };
  }, [connecting]);

  const handleDragStartPaletteRef = useCallback((ev: React.DragEvent, item: { kind: 'trigger' | 'action'; def: ActionDefinition }) => {
    ev.dataTransfer.setData('application/json', JSON.stringify({ kind: item.kind, definitionId: item.def.id, label: item.def.label, icon: item.def.icon, inputs: item.def.inputs }));
    ev.dataTransfer.effectAllowed = 'copy';
    setDragging({ item: { id: `palette-${Date.now()}`, type: item.kind, label: item.def.label, icon: item.def.icon, top: 0, left: 0, inputs: item.def.inputs, args: {}, isConfigured: false }, origin: 'palette', startX: ev.clientX, startY: ev.clientY });
  }, []);

  const validatePipeline = useCallback((): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    nodes.forEach((node) => {
      if (!node.isConfigured) {
        const missing = node.inputs.filter((p) => !p.optional && !node.args[p.name]?.trim()).map((p) => p.name);
        if (missing.length > 0) {
          errors.push(`"${node.label}" is missing required inputs: ${missing.join(', ')}`);
        }
      }
    });
    edges.forEach((edge) => {
      const from = nodes.find((n) => n.id === edge.fromNodeId);
      const to = nodes.find((n) => n.id === edge.toNodeId);
      if (!from || !to) {
        errors.push(`Edge references a missing node.`);
      }
    });
    const hasTrigger = nodes.some((n) => n.type === 'trigger');
    if (!hasTrigger) errors.push('Workflow must start with a trigger node.');
    const hasAction = nodes.some((n) => n.type === 'action');
    if (!hasAction) errors.push('Workflow must include at least one action node.');
    return { valid: errors.length === 0, errors };
  }, [nodes, edges]);

  const compilePipeline = useCallback((): CompiledPipeline => {
    const validation = validatePipeline();
    const blocks: CompiledBlock[] = nodes.map((node) => {
      const missing = node.inputs.filter((p) => !p.optional && !node.args[p.name]?.trim()).map((p) => p.name);
      const args: Record<string, unknown> = {};
      node.inputs.forEach((param) => {
        const value = node.args[param.name]?.trim();
        if (value === undefined || value === '') {
          args[param.name] = null;
          return;
        }
        switch (param.type) {
          case 'bool':
            args[param.name] = value.toLowerCase() === 'true' || value === '1';
            break;
          case 'u8':
          case 'u16':
          case 'u32':
          case 'u64':
          case 'u128':
            args[param.name] = BigInt(value);
            break;
          case 'i8':
          case 'i16':
          case 'i32':
          case 'i64':
          case 'i128':
            args[param.name] = BigInt(value);
            break;
          default:
            args[param.name] = value;
        }
      });
      return {
        instanceId: node.id,
        kind: node.type,
        contractAddress: builder.blocks.find((b) => b.instanceId === node.id)?.contractAddress ?? '',
        functionName: builder.blocks.find((b) => b.instanceId === node.id)?.functionName ?? node.functionName ?? node.label.toLowerCase().replace(/\s+/g, '_'),
        args,
        missing,
      };
    });
    const edgeList: CompiledEdge[] = edges.map((edge) => ({
      id: edge.id,
      from: edge.fromNodeId,
      to: edge.toNodeId,
      label: edge.label,
    }));
    return {
      templateId: builder.buildTemplate().id,
      name: builder.templateName || 'Untitled Workflow',
      edges: edgeList,
      blocks,
      valid: validation.valid,
      validationErrors: validation.errors,
    };
  }, [nodes, edges, builder, validatePipeline]);

  const handleCompile = useCallback(() => {
    const pipeline = compilePipeline();
    setCompiled(pipeline);
    onCompile?.(pipeline);
  }, [compilePipeline, onCompile]);

  const renderNode = useCallback((node: WorkflowNode, index: number) => {
    const isSelected = selectedNodeId === node.id;
    const inEdges = edges.filter((e) => e.toNodeId === node.id);
    const outEdges = edges.filter((e) => e.fromNodeId === node.id);
    const isConnectingFrom = connecting?.fromNodeId === node.id;
    return (
      <div
        key={node.id}
        data-node-id={node.id}
        data-port={undefined}
        className={`absolute rounded-xl border-2 border-slate-700 bg-slate-800/95 p-3 shadow-xl transition-shadow ${isSelected ? 'ring-2 ring-sky-400 shadow-sky-500/40' : ''}`}
        style={{ top: node.top, left: node.left, width: 180 }}
        onMouseDown={(ev) => onMouseDownNodeRef(ev, node.id)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{node.icon}</span>
            <span className="text-sm font-medium text-slate-100 truncate">{node.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${node.type === 'trigger' ? 'bg-indigo-500/20 text-indigo-200' : 'bg-emerald-500/20 text-emerald-200'}`}>
              {node.type}
            </span>
            <button
              type="button"
              onClick={(ev) => { ev.stopPropagation(); removeNode(node.id); }}
              className="rounded bg-slate-700/60 p-1 text-slate-300 transition hover:bg-rose-500/40 hover:text-rose-200"
              aria-label={`Remove ${node.label} node`}
            >
              ×
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <span className="font-mono">{node.functionName || 'noop'}</span>
          {node.isConfigured ? (
            <span className="flex items-center gap-1 text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> configured
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> incomplete
            </span>
          )}
        </div>

        <div className="mt-2 space-y-1.5">
          {node.inputs.map((param) => {
            const value = node.args[param.name] ?? '';
            const isMissing = !param.optional && !value.trim();
            return (
              <label key={param.name} className="flex flex-col gap-0.5 text-xs">
                <span className="text-slate-400">{param.name}</span>
                <input
                  type="text"
                  value={value}
                  onChange={(ev) => updateNodeArg(node.id, param.name, ev.target.value)}
                  placeholder={`${param.type}${param.optional ? ' (opt)' : ''}`}
                  className={`rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 placeholder-slate-500 transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400 ${isMissing ? 'border-rose-500' : ''}`}
                  onClick={(ev) => ev.stopPropagation()}
                />
              </label>
            );
          })}
        </div>

        <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
          {node.contractAddress ? (
            <span className="font-mono truncate max-w-[120px]">{node.contractAddress}</span>
          ) : (
            <span className="italic">no contract</span>
          )}
        </div>

        {node.type === 'action' && outEdges.length === 0 && (
          <div
            data-handle
            data-port="out"
            data-node-id={node.id}
            className="mt-2 cursor-crosshair rounded border-2 border-dashed border-sky-400/60 bg-sky-400/10 p-1 text-[10px] text-sky-300 transition hover:bg-sky-400/20 hover:border-sky-300"
            style={{ textAlign: 'center' }}
          >
            + connect
          </div>
        )}
        {node.type === 'action' && outEdges.length > 0 && (
          <div data-port="out" data-node-id={node.id} className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> outputs: {outEdges.length}
          </div>
        )}
        {inEdges.length > 0 && (
          <div data-port="in" data-node-id={node.id} className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> inputs: {inEdges.length}
          </div>
        )}
      </div>
    );
  }, [selectedNodeId, edges, connecting, removeNode, updateNodeArg, onMouseDownNodeRef]);

  const renderEdge = useCallback((edge: WorkflowEdge) => {
    const fromNode = nodes.find((n) => n.id === edge.fromNodeId);
    const toNode = nodes.find((n) => n.id === edge.toNodeId);
    if (!fromNode || !toNode) return null;
    const from = { x: fromNode.left + 180 / 2, y: fromNode.top + 220 };
    const to = { x: toNode.left, y: toNode.top + 40 };
    const path = bezierPath(from.x, from.y, to.x, to.y);
    return (
      <g key={edge.id} className="pointer-events-none">
        <path d={path} className="stroke-sky-400/80 fill-none stroke-2" strokeLinecap="round" />
        <circle cx={from.x} cy={from.y} r={4} className="fill-sky-300" />
        <circle cx={to.x} cy={to.y} r={4} className="fill-amber-300" />
      </g>
    );
  }, [nodes]);

  const renderConnectingLine = useCallback(() => {
    if (!connecting) return null;
    const fromNode = nodes.find((n) => n.id === connecting.fromNodeId);
    if (!fromNode) return null;
    const from = { x: fromNode.left + 180 / 2, y: fromNode.top + 220 };
    const to = { x: connecting.fromX, y: connecting.fromY };
    const path = bezierPath(from.x, from.y, to.x, to.y, 0.3);
    return (
      <g className="pointer-events-none">
        <path d={path} className="stroke-sky-300 fill-none stroke-2 stroke-dasharray" strokeDasharray="6 4" />
        <circle cx={to.x} cy={to.y} r={5} className="fill-sky-300 animate-pulse" />
      </g>
    );
  }, [connecting, nodes]);

  return (
    <div
      ref={canvasRef}
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/80 shadow-2xl ${className}`}
      onDragOver={handleDragOverCanvasRef}
      onDrop={handleDropCanvasRef}
      onDragEnd={handleDragEndRef}
      onMouseMove={handleMouseMoveCanvasRef}
      onMouseUp={handleMouseUpCanvasRef}
      style={{ height: 640 }}
    >
      {/* Palette */}
      <div className="z-10 flex shrink-0 gap-2 border-b border-slate-700 bg-slate-950/80 p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Palette</span>
        {paletteItems.map((item) => (
          <div
            key={item.def.id}
            draggable
            onDragStart={(ev) => onDragStartPaletteRef(ev, item)}
            className={`cursor-grab rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 shadow-sm transition hover:border-sky-400 hover:bg-slate-700 active:cursor-grabbing ${item.kind === 'trigger' ? 'border-l-indigo-400' : 'border-l-emerald-400'}`}
          >
            <span className="mr-1.5">{item.def.icon}</span>
            {item.def.label}
            <span className="ml-2 text-[10px] text-slate-500">({item.kind})</span>
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        {/* Grid */}
        <svg className="absolute inset-0 z-0 w-full h-full pointer-events-none" style={{ color: 'rgba(148,163,184,0.06)' }}>
          <pattern id="grid" width={24} height={24} patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth={0.5} />
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Edges layer */}
        <svg className="absolute inset-0 z-10 w-full h-full pointer-events-none" style={{ color: 'rgba(148,163,184,0.06)' }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-sky-400" />
            </marker>
          </defs>
          {edges.map(renderEdge)}
          {renderConnectingLine()}
        </svg>

        {/* Nodes */}
        {nodes.map(renderNode)}

        {/* Drop indicator */}
        {dragging?.origin === 'palette' && (
          <div
            className="pointer-events-none absolute rounded-lg border-2 border-dashed border-sky-400/70 bg-sky-400/10 shadow-lg"
            style={{ width: 180, height: 220, left: dragging.item.left, top: dragging.item.top }}
          />
        )}
      </div>

      {/* Inspector & controls */}
      <div className="shrink-0 border-t border-slate-700 bg-slate-950/90 p-4 space-y-4">
        {/* Validation */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCompile}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-emerald-500 active:scale-[0.98]"
          >
            Compile pipeline
          </button>
          <div className="flex-1" />
          {compiled ? (
            <div className={`rounded-lg px-3 py-2 text-xs font-mono ${compiled.valid ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'}`}>
              <span className="font-semibold">{compiled.valid ? 'Valid' : 'Invalid'}</span>
              <span className="mx-2 opacity-40">·</span>
              <span>{compiled.blocks.length} blocks · {compiled.edges.length} edges</span>
            </div>
          ) : (
            <div className="text-xs text-slate-500">Ready to compile</div>
          )}
        </div>

        {/* Validation errors */}
        {compiled && !compiled.valid && (
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-rose-300">Validation issues</div>
            {compiled.validationErrors.map((err, i) => (
              <div key={i} className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-200">
                {err}
              </div>
            ))}
          </div>
        )}

        {/* Compiled payload preview */}
        {compiled && compiled.valid && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Compiled Soroban payload</div>
            <pre className="max-h-32 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-200">
              {JSON.stringify(compiled, null, 2)}
            </pre>
          </div>
        )}

        {/* Node inspector */}
        {selectedNode && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Inspector · <span className="text-slate-200">{selectedNode.label}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Type: {selectedNode.type}</span>
              <span className="opacity-40">·</span>
              <span>ID: {selectedNode.id}</span>
            </div>
          </div>
        )}

        {/* Help */}
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
          <span>Drag palette items onto the canvas.</span>
          <span>Drag canvas nodes to reposition.</span>
          <span>Drag the <span className="text-sky-300 font-semibold">+ connect</span> handle to another node.</span>
          <span>Click a node to inspect.</span>
        </div>
      </div>
    </div>
  );
}

export default WorkflowBuilder;
