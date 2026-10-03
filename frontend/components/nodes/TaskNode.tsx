'use client';

import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { TaskFlowNodeData } from '@/lib/dagToRegisterParams';

export default function TaskNode({ data, selected }: NodeProps<TaskFlowNodeData>) {
  return (
    <div className={`taskNode ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="nodeHeader">{data.label || 'Task'}</div>
      {data.description && <p className="nodeDescription">{data.description}</p>}
      <div className="nodeMeta">
        {data.resolverId && <span>Resolver: {data.resolverId}</span>}
        {data.contractId && <span>Contract: {data.contractId}</span>}
        {data.method && <span>Method: {data.method}</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
