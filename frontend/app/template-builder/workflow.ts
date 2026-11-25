import type { ActionBlock, ActionDefinition, FlowTemplate } from './types';

export interface WorkflowStage {
  id: string;
  name: string;
  description?: string;
  blockIds: string[];
  condition?: WorkflowCondition;
}

export interface WorkflowCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains';
  value: string;
  targetStageId: string;
}

export interface WorkflowTemplate extends Omit<FlowTemplate, 'blocks'> {
  stages: WorkflowStage[];
  defaultStageId: string;
}

export function createWorkflowFromBlocks(
  template: FlowTemplate
): WorkflowTemplate {
  const defaultStageId = `stage-${Date.now()}`;
  const stage: WorkflowStage = {
    id: defaultStageId,
    name: 'Main Flow',
    blockIds: template.blocks.map((b) => b.instanceId),
  };

  return {
    ...template,
    stages: [stage],
    defaultStageId,
  };
}

export function reorderInStage(
  workflow: WorkflowTemplate,
  stageId: string,
  fromIndex: number,
  toIndex: number
): WorkflowTemplate {
  const stages = workflow.stages.map((stage) => {
    if (stage.id !== stageId) return stage;
    const blockIds = [...stage.blockIds];
    const [moved] = blockIds.splice(fromIndex, 1);
    blockIds.splice(toIndex, 0, moved);
    return { ...stage, blockIds };
  });

  return { ...workflow, stages };
}

export function createStage(
  workflow: WorkflowTemplate,
  name: string,
  afterStageId: string
): WorkflowTemplate {
  const stages = [...workflow.stages];
  const idx = stages.findIndex((s) => s.id === afterStageId);
  const newStage: WorkflowStage = {
    id: `stage-${Date.now()}`,
    name,
    blockIds: [],
  };
  stages.splice(idx + 1, 0, newStage);
  return { ...workflow, stages };
}

export function moveBlockToStage(
  workflow: WorkflowTemplate,
  instanceId: string,
  fromStageId: string,
  toStageId: string,
  toIndex: number
): WorkflowTemplate {
  const stages = workflow.stages.map((stage) => {
    if (stage.id !== fromStageId && stage.id !== toStageId) return stage;
    let blockIds = stage.id === fromStageId
      ? stage.blockIds.filter((id) => id !== instanceId)
      : stage.blockIds;
    if (stage.id === toStageId) {
      blockIds = [...blockIds];
      blockIds.splice(Math.min(toIndex, blockIds.length), 0, instanceId);
    }
    return { ...stage, blockIds };
  });

  return { ...workflow, stages };
}
