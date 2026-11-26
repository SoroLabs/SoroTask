import type { Edge, Node } from 'reactflow';

export type TaskNodeKind = 'task' | 'resolver' | 'target';

export interface TaskFlowNodeData {
  kind: TaskNodeKind;
  label: string;
  description?: string;
  // Task specific fields
  taskId?: string;
  resolverId?: string;
  contractId?: string;
  method?: string;
  args?: unknown[];
  condition?: string;
  dependencies?: string[];
}

export type TaskFlowNode = Node<TaskFlowNodeData>;

export interface RegisterTaskParam {
  id: string;
  description?: string;
  resolver?: string;
  contract?: string;
  method?: string;
  args?: unknown[];
  condition?: string;
  dependencies: string[];
}

export interface RegisterParams {
  targetContract?: string;
  tasks: RegisterTaskParam[];
}

function nodeId(node: TaskFlowNode): string {
  return node.data?.taskId ?? node.data?.resolverId ?? node.data?.contractId ?? node.id;
}

function collectDependencies(nodeId: string, edges: Edge[]): string[] {
  const deps: string[] = [];
  for (const edge of edges) {
    if (edge.target === nodeId) {
      deps.push(edge.source);
    }
  }
  return deps;
}

export function dagToRegisterParams(
  nodes: TaskFlowNode[],
  edges: Edge[],
): RegisterParams {
  const tasks: RegisterTaskParam[] = [];
  let targetContract: string | undefined;

  for (const node of nodes) {
    const data = node.data;
    if (!data) continue;
    if (data.kind === 'target') {
      targetContract = data.contractId ?? data.label;
      continue;
    }
    if (data.kind === 'resolver') {
      continue;
    }
    const id = nodeId(node);
    const dependencies = data.dependencies ?? collectDependencies(id, edges);
    tasks.push({
      id,
      description: data.description,
      resolver: data.resolverId,
      contract: data.contractId,
      method: data.method,
      args: data.args,
      condition: data.condition,
      dependencies,
    });
  }

  return { targetContract, tasks };
}
