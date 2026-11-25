import { SankeyData, ParsedSankeyData, SankeyNode, SankeyLink } from "../../types/tokenomics";

/**
 * Parses and validates raw tokenomics data.
 * Automatically detects cycles, isolates feedback loops to prevent infinite rendering loops,
 * validates nodes/links, and assigns depth levels to nodes for horizontal placement.
 */
export function parseTokenomicsData(rawData: any): ParsedSankeyData {
  const warnings: string[] = [];
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const feedbackLinks: SankeyLink[] = [];

  // 1. Validate raw structure
  if (!rawData || typeof rawData !== "object") {
    return { nodes: [], links: [], feedbackLinks: [], warnings: ["Invalid root data structure"] };
  }

  // 2. Parse and sanitize Nodes
  const rawNodes = Array.isArray(rawData.nodes) ? rawData.nodes : [];
  const nodeMap = new Map<string, SankeyNode>();

  for (const rawNode of rawNodes) {
    if (!rawNode || typeof rawNode !== "object") {
      warnings.push("Skipped invalid node object");
      continue;
    }
    const id = String(rawNode.id || "").trim();
    const name = String(rawNode.name || id || "").trim();
    if (!id) {
      warnings.push("Skipped node with missing ID");
      continue;
    }
    if (nodeMap.has(id)) {
      warnings.push(`Duplicate node ID detected and skipped: ${id}`);
      continue;
    }

    const node: SankeyNode = {
      id,
      name,
      color: rawNode.color || undefined,
    };
    nodeMap.set(id, node);
    nodes.push(node);
  }

  // 3. Parse and sanitize Links
  const rawLinks = Array.isArray(rawData.links) ? rawData.links : [];
  const validRawLinks: SankeyLink[] = [];

  for (const rawLink of rawLinks) {
    if (!rawLink || typeof rawLink !== "object") {
      warnings.push("Skipped invalid link object");
      continue;
    }
    const source = String(rawLink.source || "").trim();
    const target = String(rawLink.target || "").trim();
    const value = Number(rawLink.value);

    if (!source || !target) {
      warnings.push(`Skipped link with missing endpoint: source=${source}, target=${target}`);
      continue;
    }
    if (!nodeMap.has(source)) {
      warnings.push(`Skipped link referencing missing source node: ${source}`);
      continue;
    }
    if (!nodeMap.has(target)) {
      warnings.push(`Skipped link referencing missing target node: ${target}`);
      continue;
    }
    if (isNaN(value) || value <= 0) {
      warnings.push(`Skipped link with invalid value: source=${source}, target=${target}, value=${value}`);
      continue;
    }
    if (source === target) {
      warnings.push(`Self-referencing link detected and marked as feedback loop: ${source}`);
      feedbackLinks.push({ source, target, value, color: rawLink.color, isFeedback: true });
      continue;
    }

    validRawLinks.push({
      source,
      target,
      value,
      color: rawLink.color || undefined,
    });
  }

  // 4. Cycle Detection & Removal (DFS)
  // Construct adjacency list from valid links
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node.id, []);
  }
  for (const link of validRawLinks) {
    adj.get(link.source)?.push(link.target);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const backEdges = new Set<string>(); // "source->target" format

  function dfsDetectCycles(u: string) {
    visited.add(u);
    recStack.add(u);

    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      if (recStack.has(v)) {
        // Back edge found!
        backEdges.add(`${u}->${v}`);
      } else if (!visited.has(v)) {
        dfsDetectCycles(v);
      }
    }

    recStack.delete(u);
  }

  // Run DFS from all unvisited nodes
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfsDetectCycles(node.id);
    }
  }

  // Separate feedback loops from regular links
  for (const link of validRawLinks) {
    const key = `${link.source}->${link.target}`;
    if (backEdges.has(key)) {
      warnings.push(`Cycle detected. Link ${link.source} -> ${link.target} isolated as feedback loop.`);
      feedbackLinks.push({ ...link, isFeedback: true });
    } else {
      links.push(link);
    }
  }

  // 5. Calculate Node values based on non-feedback links
  // Node value = max(sum(incoming), sum(outgoing))
  const nodeIncomingSum = new Map<string, number>();
  const nodeOutgoingSum = new Map<string, number>();

  for (const node of nodes) {
    nodeIncomingSum.set(node.id, 0);
    nodeOutgoingSum.set(node.id, 0);
  }

  for (const link of links) {
    nodeOutgoingSum.set(link.source, (nodeOutgoingSum.get(link.source) || 0) + link.value);
    nodeIncomingSum.set(link.target, (nodeIncomingSum.get(link.target) || 0) + link.value);
  }

  for (const node of nodes) {
    const incoming = nodeIncomingSum.get(node.id) || 0;
    const outgoing = nodeOutgoingSum.get(node.id) || 0;
    node.value = Math.max(incoming, outgoing);
    // Handle isolated nodes value
    if (node.value === 0) {
      node.value = 1; // Default min value for isolated nodes
    }
  }

  // 6. Layer/Depth calculation (Longest path on the DAG)
  // For standard Sankey layout, horizontal placement is dictated by node depth.
  const depths = new Map<string, number>();
  
  // Initialize map
  for (const node of nodes) {
    depths.set(node.id, -1);
  }

  // Topologically compute depths
  function computeDepth(u: string): number {
    if (depths.get(u) !== -1) {
      return depths.get(u)!;
    }

    // Incomings of u
    const parentLinks = links.filter((l) => l.target === u);
    if (parentLinks.length === 0) {
      depths.set(u, 0);
      return 0;
    }

    let maxParentDepth = 0;
    for (const link of parentLinks) {
      maxParentDepth = Math.max(maxParentDepth, computeDepth(link.source));
    }

    const calculatedDepth = maxParentDepth + 1;
    depths.set(u, calculatedDepth);
    return calculatedDepth;
  }

  for (const node of nodes) {
    computeDepth(node.id);
  }

  // Assign depth to nodes
  for (const node of nodes) {
    node.depth = depths.get(node.id) || 0;
  }

  return {
    nodes,
    links,
    feedbackLinks,
    warnings,
  };
}
