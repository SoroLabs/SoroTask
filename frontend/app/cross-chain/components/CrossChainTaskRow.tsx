'use client';

import React from 'react';
import { CrossChainTask, NETWORKS } from '../types';
import { NetworkBadge, ChainStatusIndicator } from './NetworkBadge';

const OVERALL_STYLES: Record<CrossChainTask['overallStatus'], string> = {
  active:    'text-green-400',
  paused:    'text-yellow-400',
  completed: 'text-neutral-400',
  failed:    'text-red-400',
};

interface CrossChainTaskRowProps {
  task: CrossChainTask;
  /** All network columns to show (union of all tasks' networks) */
  allNetworks: CrossChainTask['networks'][number][];
}

export function CrossChainTaskRow({ task, allNetworks }: CrossChainTaskRowProps) {
  return (
    <tr
      data-testid={`cc-task-row-${task.id}`}
      className="border-b border-neutral-800 hover:bg-neutral-800/40 transition-colors"
    >
      {/* Title + origin */}
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-neutral-200 truncate max-w-[180px]">{task.title}</p>
        <div className="mt-1">
          <NetworkBadge networkId={task.originNetwork} />
        </div>
      </td>

      {/* Per-network status columns */}
      {allNetworks.map((netId) => {
        const cs = task.chainStatuses[netId];
        return (
          <td key={netId} className="px-4 py-3 text-center">
            {cs ? (
              <ChainStatusIndicator
                networkId={netId}
                status={cs.status}
                error={cs.error}
              />
            ) : (
              <span className="text-neutral-700 text-xs" aria-label={`${NETWORKS[netId].label}: not applicable`}>—</span>
            )}
          </td>
        );
      })}

      {/* Overall status */}
      <td className="px-4 py-3">
        <span className={`text-xs font-semibold capitalize ${OVERALL_STYLES[task.overallStatus]}`}>
          {task.overallStatus}
        </span>
      </td>

      {/* Last updated */}
      <td className="px-4 py-3 text-xs text-neutral-500 whitespace-nowrap">
        {new Date(task.lastUpdatedAt).toLocaleTimeString()}
      </td>
    </tr>
  );
}
