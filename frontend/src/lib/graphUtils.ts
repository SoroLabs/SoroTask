import type { Task, TaskDependency, GraphNode, GraphEdge } from "@/src/types/task";

/**
 * Converts tasks and dependency edges into the node/edge shapes the graph
 * component consumes.
 *
 * @param tasks       - Full task map (id → Task)
 * @param deps        - Directed dependency list
 * @param selectedId  - Currently focused task id (highlighted in graph)
 */
export function buildGraphData(
  tasks: Record<string, Task>,
  deps: TaskDependency[],
  selectedId: string | null = null
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // Collect the set of task ids that actually appear in the dependency list
  const referencedIds = new Set<string>();
  for (const { fromId, toId } of deps) {
    referencedIds.add(fromId);
    referencedIds.add(toId);
  }

  // Build nodes — include every task that appears in at least one edge,
  // plus the selected task even if it has no edges yet.
  const nodeIds = new Set(referencedIds);
  if (selectedId) nodeIds.add(selectedId);

  const nodes: GraphNode[] = Array.from(nodeIds)
    .filter((id) => tasks[id]) // skip dangling references
    .map((id) => ({
      id,
      label: tasks[id].title,
      selected: id === selectedId,
    }));

  // Build edges — deduplicate by composite key, skip self-loops
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const { fromId, toId } of deps) {
    if (fromId === toId) continue; // no self-loops
    if (!tasks[fromId] || !tasks[toId]) continue; // skip dangling refs
    const key = `${fromId}→${toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: key, source: fromId, target: toId });
  }

  return { nodes, edges };
}

/**
 * Returns all task ids that directly block the given task
 * (i.e. tasks that `taskId` depends on).
 */
export function getBlockingTasks(
  taskId: string,
  deps: TaskDependency[]
): string[] {
  return deps.filter((d) => d.fromId === taskId).map((d) => d.toId);
}

/**
 * Returns all task ids that are directly blocked by the given task
 * (i.e. tasks that depend on `taskId`).
 */
export function getBlockedTasks(
  taskId: string,
  deps: TaskDependency[]
): string[] {
  return deps.filter((d) => d.toId === taskId).map((d) => d.fromId);
}

/**
 * Validates a proposed new dependency edge.
 * Returns an error string or null if valid.
 */
export function validateDependency(
  fromId: string,
  toId: string,
  existingDeps: TaskDependency[]
): string | null {
  if (fromId === toId) return "A task cannot depend on itself.";

  const key = `${fromId}→${toId}`;
  const exists = existingDeps.some(
    (d) => `${d.fromId}→${d.toId}` === key
  );
  if (exists) return "This dependency already exists.";

  if (wouldCreateCycle(fromId, toId, existingDeps)) {
    return "Adding this dependency would create a cycle.";
  }

  return null;
}

/**
 * Detects whether adding fromId → toId would create a cycle using DFS.
 */
export function wouldCreateCycle(
  fromId: string,
  toId: string,
  deps: TaskDependency[]
): boolean {
  // Build adjacency: node → nodes it points to
  const adj: Record<string, string[]> = {};
  for (const { fromId: f, toId: t } of deps) {
    if (!adj[f]) adj[f] = [];
    adj[f].push(t);
  }
  // Temporarily add the proposed edge
  if (!adj[fromId]) adj[fromId] = [];
  adj[fromId] = [...adj[fromId], toId];

  // DFS from toId — if we can reach fromId, it's a cycle
  const visited = new Set<string>();
  const stack = [toId];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === fromId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const neighbour of adj[node] ?? []) {
      stack.push(neighbour);
    }
  }
  return false;
}

/**
 * Filters the dependency list to only edges connected to a given task id
 * (one hop in either direction). Useful for focused/neighbourhood views.
 */
export function filterToNeighbourhood(
  taskId: string,
  deps: TaskDependency[]
): TaskDependency[] {
  return deps.filter((d) => d.fromId === taskId || d.toId === taskId);
}
