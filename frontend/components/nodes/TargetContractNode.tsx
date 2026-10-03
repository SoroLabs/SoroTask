'use client';

import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { TaskFlowNodeData } from '@/lib/dagToRegisterParams';

export default function TargetContractNode({ data, selected }: NodeProps<TaskFlowNodeData>) {
  return (
    <div className={`targetContractNode ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="nodeHeader">{data.label || 'Target Contract'}</div>
      {data.contractId && <p className="nodeDescription">{data.contractId}</p>}
    </div>
  );
}
