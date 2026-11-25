'use client';

import React, { useRef, useState } from 'react';
import { ActionBlock, ActionDefinition } from '../types';
import { ActionBlockCard } from './ActionBlockCard';

interface FlowCanvasProps {
  blocks: ActionBlock[];
  onAddBlock: (def: ActionDefinition) => void;
  onRemoveBlock: (instanceId: string) => void;
  onArgChange: (instanceId: string, argName: string, value: string) => void;
  onContractChange: (instanceId: string, contractAddress: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Called when a definition id is dropped from the palette */
  onDropDefinition: (definitionId: string) => void;
}

export function FlowCanvas({
  blocks,
  onRemoveBlock,
  onArgChange,
  onContractChange,
  onReorder,
  onDropDefinition,
}: FlowCanvasProps) {
  const dragFromIndex = useRef<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleCanvasDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('text/x-definition-id')
      ? 'copy'
      : 'move';
    setIsDragOver(true);
  }

  function handleCanvasDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const definitionId = e.dataTransfer.getData('text/x-definition-id');
    if (definitionId) {
      onDropDefinition(definitionId);
      dragFromIndex.current = null;
    }
  }

  function handleBlockDragStart(index: number) {
    dragFromIndex.current = index;
  }

  function handleBlockDrop(toIndex: number) {
    if (dragFromIndex.current !== null) {
      onReorder(dragFromIndex.current, toIndex);
      dragFromIndex.current = null;
    }
  }

  const isEmpty = blocks.length === 0;

  return (
    <div
      role="region"
      aria-label="Flow canvas"
      data-testid="flow-canvas"
      onDragOver={handleCanvasDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleCanvasDrop}
      className={`flex-1 overflow-y-auto p-6 transition-colors ${
        isDragOver ? 'bg-blue-950/30' : 'bg-neutral-950'
      }`}
    >
      {isEmpty ? (
        <div
          className={`h-full flex flex-col items-center justify-center border-2 border-dashed rounded-xl transition-colors ${
            isDragOver ? 'border-blue-500 text-blue-400' : 'border-neutral-800 text-neutral-600'
          }`}
          aria-label="Drop actions here to build your flow"
        >
          <span className="text-4xl mb-3" aria-hidden="true">
            {isDragOver ? '⬇️' : '🧩'}
          </span>
          <p className="text-sm font-medium">
            {isDragOver ? 'Release to add' : 'Drag actions here'}
          </p>
          <p className="text-xs mt-1 text-neutral-700">
            Or click an action in the palette to add it
          </p>
        </div>
      ) : (
        <div className="space-y-4 max-w-lg mx-auto">
          {/* Top drop-zone hint when dragging */}
          {isDragOver && (
            <div className="h-2 rounded-full bg-blue-500/50 animate-pulse" aria-hidden="true" />
          )}

          {blocks.map((block, index) => (
            <React.Fragment key={block.instanceId}>
              <ActionBlockCard
                block={block}
                index={index}
                onRemove={onRemoveBlock}
                onArgChange={onArgChange}
                onContractChange={onContractChange}
                onDragStart={handleBlockDragStart}
                onDrop={handleBlockDrop}
              />
              {/* Flow connector */}
              {index < blocks.length - 1 && (
                <div className="flex justify-center" aria-hidden="true">
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="w-px h-4 bg-neutral-700" />
                    <div className="text-neutral-600 text-xs">↓</div>
                    <div className="w-px h-4 bg-neutral-700" />
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
