"use client";

import React, {
  useState,
  useDeferredValue,
  useTransition,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { parseTokenomicsData } from "../../lib/tokenomics/parser";
import { SankeyNode, SankeyLink, ParsedSankeyData } from "../../types/tokenomics";
import GraphErrorBoundary from "./GraphErrorBoundary";

// Default datasets for testing and showcase
const SIMPLE_FLOW = {
  nodes: [
    { id: "supply", name: "Total Supply", color: "#10B981" },
    { id: "treasury", name: "Community Treasury", color: "#3B82F6" },
    { id: "team", name: "Team Allocations", color: "#8B5CF6" },
    { id: "rewards", name: "Staking Rewards", color: "#F59E0B" },
    { id: "burn", name: "Fee Burn Pool", color: "#EF4444" },
  ],
  links: [
    { source: "supply", target: "treasury", value: 50 },
    { source: "supply", target: "team", value: 20 },
    { source: "supply", target: "rewards", value: 30 },
    { source: "treasury", target: "rewards", value: 15 },
    { source: "rewards", target: "burn", value: 10 },
  ],
};

const COMPLEX_DEFI_FLOW = {
  nodes: [
    { id: "mint", name: "Token Mint", color: "#10B981" },
    { id: "lp", name: "Liquidity Pools", color: "#3B82F6" },
    { id: "staking", name: "Staking Vaults", color: "#6366F1" },
    { id: "fees", name: "Protocol Fees Collector", color: "#F59E0B" },
    { id: "treasury", name: "DAO Treasury", color: "#EC4899" },
    { id: "buyback", name: "Buyback & Burn", color: "#EF4444" },
    { id: "rewards", name: "LPs Yield Rewards", color: "#06B6D4" },
  ],
  links: [
    { source: "mint", target: "lp", value: 100 },
    { source: "mint", target: "staking", value: 50 },
    { source: "lp", target: "fees", value: 30 },
    { source: "staking", target: "fees", value: 15 },
    { source: "fees", target: "treasury", value: 20 },
    { source: "fees", target: "buyback", value: 15 },
    { source: "fees", target: "rewards", value: 10 },
    { source: "treasury", target: "staking", value: 5 },
  ],
};

const LOOPY_FLOW = {
  nodes: [
    { id: "users", name: "Users Deposits", color: "#10B981" },
    { id: "bridge", name: "Cross-chain Bridge", color: "#3B82F6" },
    { id: "lending", name: "Lending Market", color: "#F59E0B" },
    { id: "yield", name: "Yield Compounder", color: "#EC4899" },
  ],
  links: [
    { source: "users", target: "bridge", value: 80 },
    { source: "bridge", target: "lending", value: 75 },
    { source: "lending", target: "yield", value: 60 },
    // Cyclic link that will be parsed as feedback loop
    { source: "yield", target: "users", value: 25 },
  ],
};

const DATASETS: Record<string, { label: string; data: any }> = {
  simple: { label: "Simple Supply Split", data: SIMPLE_FLOW },
  complex: { label: "Complex DeFi Engine", data: COMPLEX_DEFI_FLOW },
  loopy: { label: "Bridge Cyclic Flow", data: LOOPY_FLOW },
};

interface SankeyDiagramProps {
  initialDatasetKey?: string;
  width?: number;
  height?: number;
}

export function SankeyDiagramContent({
  initialDatasetKey = "simple",
  width = 800,
  height = 500,
}: SankeyDiagramProps) {
  // Concurrent transition for switching datasets
  const [isPending, startTransition] = useTransition();
  const [datasetKey, setDatasetKey] = useState<string>(initialDatasetKey);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Drag interaction states
  const [customOffsets, setCustomOffsets] = useState<Record<string, number>>({});
  const draggingNodeRef = useRef<string | null>(null);
  const dragStartYRef = useRef<number>(0);
  const initialOffsetRef = useRef<number>(0);

  // Hover states for tooltips
  const [hoveredNode, setHoveredNode] = useState<SankeyNode | null>(null);
  const [hoveredLink, setHoveredLink] = useState<{
    link: SankeyLink;
    sourceName: string;
    targetName: string;
    x: number;
    y: number;
  } | null>(null);

  // Reset custom layout drag-offsets when dataset changes
  useEffect(() => {
    setCustomOffsets({});
  }, [datasetKey]);

  // Read current dataset
  const activeDataset = DATASETS[datasetKey]?.data || SIMPLE_FLOW;

  // Process data (parsing & cycle detection)
  const parsedData: ParsedSankeyData = useMemo(() => {
    return parseTokenomicsData(activeDataset);
  }, [activeDataset]);

  // SVG Dimension params
  const padding = 40;
  const nodeWidth = 24;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;

  // Lay out the Sankey nodes & links
  const layout = useMemo(() => {
    const { nodes, links } = parsedData;
    if (nodes.length === 0) return { layoutNodes: [], layoutLinks: [] };

    // Group nodes by depth
    const maxDepth = Math.max(...nodes.map((n) => n.depth || 0));
    const columns: SankeyNode[][] = [];
    for (let i = 0; i <= maxDepth; i++) {
      columns.push([]);
    }
    for (const node of nodes) {
      const depth = node.depth || 0;
      columns[depth]?.push(node);
    }

    // Determine vertical scaling.
    // Find the column with the maximum total node values
    let maxColVal = 0;
    for (const col of columns) {
      const sumVal = col.reduce((sum, n) => sum + (n.value || 0), 0);
      if (sumVal > maxColVal) maxColVal = sumVal;
    }

    // Value scale: unit value to height pixels
    // Reservings space for vertical gaps between nodes
    const nodeGap = 16;
    const maxColumnNodeCount = Math.max(...columns.map((c) => c.length));
    const totalGapsHeight = (maxColumnNodeCount - 1) * nodeGap;
    const usableHeight = Math.max(100, graphHeight - totalGapsHeight);
    const valueScale = maxColVal > 0 ? usableHeight / maxColVal : 1;

    // Position nodes
    const layoutNodesMap = new Map<string, SankeyNode>();
    const layoutNodes: SankeyNode[] = [];

    columns.forEach((col, colIdx) => {
      const colX =
        maxDepth > 0
          ? padding + (colIdx * (graphWidth - nodeWidth)) / maxDepth
          : padding + graphWidth / 2 - nodeWidth / 2;

      const colSum = col.reduce((sum, n) => sum + (n.value || 0), 0);
      const colGapsHeight = (col.length - 1) * nodeGap;
      const colTopY = padding + (graphHeight - (colSum * valueScale + colGapsHeight)) / 2;

      let currentY = colTopY;
      col.forEach((node) => {
        const nodeHeight = Math.max(8, (node.value || 0) * valueScale);
        const dragOffset = customOffsets[node.id] || 0;

        const layoutNode: SankeyNode = {
          ...node,
          x: colX,
          y: currentY + dragOffset,
          value: nodeHeight, // Save height in layout node's value property
        };

        layoutNodesMap.set(node.id, layoutNode);
        layoutNodes.push(layoutNode);
        currentY += nodeHeight + nodeGap;
      });
    });

    // Create indices to stack links leaving and entering each node
    const sourceLinkIndex = new Map<string, number>(); // nodeID -> current vertical offset on exit (right side)
    const targetLinkIndex = new Map<string, number>(); // nodeID -> current vertical offset on enter (left side)

    for (const node of nodes) {
      sourceLinkIndex.set(node.id, 0);
      targetLinkIndex.set(node.id, 0);
    }

    // Map links into layout links with curve endpoints and stroke widths
    const layoutLinks = links.map((link) => {
      const sourceNode = layoutNodesMap.get(link.source);
      const targetNode = layoutNodesMap.get(link.target);

      if (!sourceNode || !targetNode) {
        return null;
      }

      // Height of this link band is proportional to its value
      const strokeWidth = Math.max(2, link.value * valueScale);

      // Get link vertical offsets
      const sourceOffset = sourceLinkIndex.get(link.source) || 0;
      const targetOffset = targetLinkIndex.get(link.target) || 0;

      // Exit coordinates (right side of source)
      const x0 = sourceNode.x! + nodeWidth;
      const y0 = sourceNode.y! + sourceOffset + strokeWidth / 2;

      // Enter coordinates (left side of target)
      const x1 = targetNode.x!;
      const y1 = targetNode.y! + targetOffset + strokeWidth / 2;

      // Update vertical indices for next links on these nodes
      sourceLinkIndex.set(link.source, sourceOffset + strokeWidth);
      targetLinkIndex.set(link.target, targetOffset + strokeWidth);

      // Curved pathway coordinates
      const ctrlX = (x0 + x1) / 2;
      const pathD = `M ${x0} ${y0} C ${ctrlX} ${y0}, ${ctrlX} ${y1}, ${x1} ${y1}`;

      return {
        ...link,
        x0,
        y0,
        x1,
        y1,
        strokeWidth,
        pathD,
        sourceName: sourceNode.name,
        targetName: targetNode.name,
      };
    }).filter(Boolean);

    return { layoutNodes, layoutLinks };
  }, [parsedData, customOffsets, graphWidth, graphHeight]);

  // Concurrent node filtering based on deferred search query
  const filteredLayout = useMemo(() => {
    const query = deferredSearchQuery.toLowerCase().trim();
    if (!query) return layout;

    const matchedNodeIds = new Set(
      layout.layoutNodes
        .filter((n) => n.name.toLowerCase().includes(query) || n.id.toLowerCase().includes(query))
        .map((n) => n.id)
    );

    // Keep layout links where either source or target matches
    const filteredNodes = layout.layoutNodes.map((node) => {
      const isMatched = matchedNodeIds.has(node.id);
      return {
        ...node,
        // Visual indicator that it's filtered/dimmed
        opacity: isMatched ? 1.0 : 0.25,
      };
    });

    const filteredLinks = layout.layoutLinks.map((link) => {
      if (!link) return null;
      const isConnected = matchedNodeIds.has(link.source) || matchedNodeIds.has(link.target);
      return {
        ...link,
        opacity: isConnected ? 0.9 : 0.15,
      };
    }).filter(Boolean);

    return { layoutNodes: filteredNodes, layoutLinks: filteredLinks };
  }, [layout, deferredSearchQuery]);

  // Mouse Drag Handlers
  function handleNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    e.preventDefault();
    draggingNodeRef.current = nodeId;
    dragStartYRef.current = e.clientY;
    initialOffsetRef.current = customOffsets[nodeId] || 0;

    window.addEventListener("mousemove", handleNodeMouseMove);
    window.addEventListener("mouseup", handleNodeMouseUp);
  }

  function handleNodeMouseMove(e: MouseEvent) {
    if (!draggingNodeRef.current) return;
    const deltaY = e.clientY - dragStartYRef.current;
    const newOffset = initialOffsetRef.current + deltaY;

    setCustomOffsets((prev) => ({
      ...prev,
      [draggingNodeRef.current!]: newOffset,
    }));
  }

  function handleNodeMouseUp() {
    draggingNodeRef.current = null;
    window.removeEventListener("mousemove", handleNodeMouseMove);
    window.removeEventListener("mouseup", handleNodeMouseUp);
  }

  // Handle dataset switching with React concurrent transition
  function handleDatasetSelect(key: string) {
    startTransition(() => {
      setDatasetKey(key);
    });
  }

  return (
    <div
      className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl backdrop-blur-md"
      data-testid="sankey-diagram-container"
    >
      {/* Controls panel */}
      <header className="flex flex-col flex-wrap justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span className="inline-block size-3 rounded-full bg-emerald-400 animate-pulse" />
            Token Flow Sankey Diagram
          </h2>
          <p className="text-xs text-slate-400">
            Interactive Tokenomics flow visualizer. Click and drag nodes vertically.
          </p>
        </div>

        {/* Dataset switches */}
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(DATASETS).map(([key, item]) => (
            <button
              key={key}
              onClick={() => handleDatasetSelect(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition-all ${
                datasetKey === key
                  ? "bg-emerald-400 text-slate-950 shadow-md shadow-emerald-400/20"
                  : "bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* Concurrent Query Inputs */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter nodes by token name..."
          className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
        {searchQuery !== deferredSearchQuery && (
          <span className="absolute right-3 top-2.5 flex size-4 items-center justify-center text-[10px] font-bold text-emerald-400 animate-pulse">
            Rendering...
          </span>
        )}
      </div>

      {/* Diagram Canvas Area */}
      <div
        className="relative overflow-hidden rounded-xl border border-white/5 bg-slate-950/50"
        style={{ height }}
      >
        {/* Loading overlay during concurrent dataset transitions */}
        {isPending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="size-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
              <span className="text-xs text-slate-300 font-medium">Computing new flows...</span>
            </div>
          </div>
        )}

        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${width} ${height}`}
          className="select-none"
        >
          <defs>
            {/* Unique gradients for beautiful flows */}
            {filteredLayout.layoutLinks.map((link, idx) => {
              if (!link) return null;
              const sourceNode = filteredLayout.layoutNodes.find((n) => n.id === link.source);
              const targetNode = filteredLayout.layoutNodes.find((n) => n.id === link.target);
              return (
                <linearGradient
                  key={`grad-${link.source}-${link.target}-${idx}`}
                  id={`grad-${link.source}-${link.target}`}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor={sourceNode?.color || "#3b82f6"} stopOpacity={0.8} />
                  <stop offset="100%" stopColor={targetNode?.color || "#10b981"} stopOpacity={0.8} />
                </linearGradient>
              );
            })}
          </defs>

          {/* Links path bands */}
          <g>
            {filteredLayout.layoutLinks.map((link, idx) => {
              if (!link) return null;
              const isHovered = hoveredLink?.link.source === link.source && hoveredLink?.link.target === link.target;
              return (
                <path
                  key={`link-${link.source}-${link.target}-${idx}`}
                  d={link.pathD}
                  stroke={`url(#grad-${link.source}-${link.target})`}
                  strokeWidth={link.strokeWidth}
                  fill="none"
                  className="transition-all duration-150 cursor-pointer"
                  style={{
                    opacity: (link as any).opacity ?? (hoveredLink ? (isHovered ? 0.95 : 0.2) : 0.65),
                  }}
                  onMouseEnter={(e) => {
                    setHoveredLink({
                      link,
                      sourceName: link.sourceName,
                      targetName: link.targetName,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  onMouseMove={(e) => {
                    if (hoveredLink) {
                      setHoveredLink((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
                    }
                  }}
                  onMouseLeave={() => setHoveredLink(null)}
                />
              );
            })}
          </g>

          {/* Animated tokens flow stream (dashed lines running along links) */}
          <g className="pointer-events-none">
            {filteredLayout.layoutLinks.map((link, idx) => {
              if (!link) return null;
              const isHovered = hoveredLink?.link.source === link.source && hoveredLink?.link.target === link.target;
              return (
                <path
                  key={`link-flow-${link.source}-${link.target}-${idx}`}
                  d={link.pathD}
                  stroke="#ffffff"
                  strokeWidth={Math.max(1, link.strokeWidth / 5)}
                  strokeDasharray="8, 12"
                  strokeDashoffset="0"
                  fill="none"
                  style={{
                    opacity: isHovered ? 0.7 : 0.25,
                    animation: "sankey-flow 1.5s linear infinite",
                  }}
                />
              );
            })}
          </g>

          {/* Nodes rectangles */}
          <g>
            {filteredLayout.layoutNodes.map((node) => {
              const isHovered = hoveredNode?.id === node.id;
              const isAnyNodeHovered = hoveredNode !== null;
              const opacity = (node as any).opacity ?? (isAnyNodeHovered ? (isHovered ? 1.0 : 0.3) : 1.0);

              return (
                <g
                  key={`node-group-${node.id}`}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-ns-resize"
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ opacity }}
                >
                  <rect
                    width={nodeWidth}
                    height={node.value}
                    rx={6}
                    fill={node.color || "#4b5563"}
                    className="stroke-white/10 hover:stroke-white/40 transition-colors shadow-lg"
                  />
                  {/* Glass highlight */}
                  <rect
                    width={nodeWidth / 2}
                    height={node.value}
                    rx={3}
                    fill="#ffffff"
                    fillOpacity={0.06}
                  />

                  {/* Label Text */}
                  <text
                    x={nodeWidth + 8}
                    y={node.value! / 2}
                    dy="0.32em"
                    fill="#e2e8f0"
                    fontSize={11}
                    fontWeight="600"
                    textAnchor="start"
                    className="pointer-events-none select-none tracking-wide"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Floating Tooltips */}
        {hoveredLink && (
          <div
            className="fixed pointer-events-none z-50 rounded-lg border border-white/10 bg-slate-950/95 p-3 text-xs text-slate-100 shadow-xl"
            style={{
              left: hoveredLink.x - 60,
              top: hoveredLink.y - 80,
            }}
          >
            <p className="font-semibold text-emerald-400">
              {hoveredLink.sourceName} → {hoveredLink.targetName}
            </p>
            <p className="mt-1 text-slate-300">
              Flow Rate: <span className="font-mono font-bold text-white">{hoveredLink.link.value} M Tokens/s</span>
            </p>
          </div>
        )}

        {/* Node stats detail bar */}
        {hoveredNode && (
          <div className="absolute bottom-3 left-3 pointer-events-none rounded-lg border border-white/10 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-300">
            Node: <span className="font-bold text-white">{hoveredNode.name}</span> · Capacity:{" "}
            <span className="font-mono font-bold text-emerald-400">{hoveredNode.value ? Math.round(hoveredNode.value) : 0} units</span>
          </div>
        )}
      </div>

      {/* Warnings & Cycle Isolated Notice */}
      {parsedData.feedbackLinks.length > 0 && (
        <footer className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-4 text-xs text-amber-300">
          <p className="font-bold mb-1">Feedback Loops Isolated ({parsedData.feedbackLinks.length}):</p>
          <ul className="list-disc pl-4 space-y-1">
            {parsedData.feedbackLinks.map((link, idx) => (
              <li key={idx}>
                Feedback path: <span className="font-mono">{link.source}</span> →{" "}
                <span className="font-mono">{link.target}</span> (Value: {link.value} M Tokens) was isolated to keep
                the layout DAG acyclic and prevent infinite loop freezes.
              </li>
            ))}
          </ul>
        </footer>
      )}

      {/* Inline styles for flows */}
      <style jsx global>{`
        @keyframes sankey-flow {
          from {
            stroke-dashoffset: 20;
          }
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
    </div>
  );
}

export default function SankeyDiagram(props: SankeyDiagramProps) {
  return (
    <GraphErrorBoundary>
      <SankeyDiagramContent {...props} />
    </GraphErrorBoundary>
  );
}
