'use client';

import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { TaskFlowNodeData } from '@/lib/dagToRegisterParams';

export default function ResolverNode({ data, selected }: NodeProps<TaskFlowNodeData>) {
  return (
    <div className={`resolverNode ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="nodeHeader">{data.label || 'Resolver'}</div>
      {data.condition && <p className="nodeDescription">Condition: {data.condition}</p>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
