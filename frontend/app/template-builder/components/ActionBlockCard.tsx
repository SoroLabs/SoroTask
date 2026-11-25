'use client';

import React, { useRef } from 'react';
import { ActionBlock as ActionBlockType } from '../types';

interface ActionBlockProps {
  block: ActionBlockType;
  index: number;
  onRemove: (instanceId: string) => void;
  onArgChange: (instanceId: string, argName: string, value: string) => void;
  onContractChange: (instanceId: string, contractAddress: string) => void;
  onDragStart: (index: number) => void;
  onDrop: (toIndex: number) => void;
  onAddCondition?: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  defi: 'border-blue-500/40 bg-blue-500/5',
  transfer: 'border-green-500/40 bg-green-500/5',
  governance: 'border-purple-500/40 bg-purple-500/5',
  custom: 'border-neutral-600 bg-neutral-800/50',
};

const CATEGORY_BADGE: Record<string, string> = {
  defi: 'bg-blue-500/20 text-blue-400',
  transfer: 'bg-green-500/20 text-green-400',
  governance: 'bg-purple-500/20 text-purple-400',
  custom: 'bg-neutral-700 text-neutral-400',
};

export function ActionBlockCard({
  block,
  index,
  onRemove,
  onArgChange,
  onContractChange,
  onDragStart,
  onDrop,
}: ActionBlockProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragOverRef = useRef(false);

  const colorClass = CATEGORY_COLORS[block.category] ?? CATEGORY_COLORS.custom;
  const badgeClass = CATEGORY_BADGE[block.category] ?? CATEGORY_BADGE.custom;

  return (
    <div
      ref={cardRef}
      draggable
      data-testid={`action-block-${block.instanceId}`}
      aria-label={`Action block: ${block.label}, step ${index + 1}`}
      className={`relative rounded-lg border p-4 transition-opacity cursor-grab active:cursor-grabbing select-none ${colorClass}`}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(index);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!dragOverRef.current) {
          dragOverRef.current = true;
          cardRef.current?.classList.add('opacity-60', 'scale-[0.98]');
        }
      }}
      onDragLeave={() => {
        dragOverRef.current = false;
        cardRef.current?.classList.remove('opacity-60', 'scale-[0.98]');
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragOverRef.current = false;
        cardRef.current?.classList.remove('opacity-60', 'scale-[0.98]');
        onDrop(index);
      }}
    >
      {/* Step indicator */}
      <span
        className="absolute -left-3 -top-3 w-6 h-6 rounded-full bg-neutral-700 border border-neutral-600 flex items-center justify-center text-[10px] font-bold text-neutral-300"
        aria-hidden="true"
      >
        {index + 1}
      </span>

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">{block.icon}</span>
          <div>
            <span className="text-sm font-semibold text-neutral-200">{block.label}</span>
            <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeClass}`}>
              {block.category}
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label={`Remove ${block.label} block`}
          onClick={() => onRemove(block.instanceId)}
          className="text-neutral-600 hover:text-red-400 transition-colors text-lg leading-none -mt-0.5"
        >
          ×
        </button>
      </div>

      {/* Contract address (always editable for custom; read-only hint for pre-defined) */}
      <div className="mb-3">
        <label
          htmlFor={`${block.instanceId}-contract`}
          className="block text-[11px] font-medium text-neutral-400 mb-1"
        >
          Contract Address
        </label>
        <input
          id={`${block.instanceId}-contract`}
          type="text"
          value={block.contractAddress}
          onChange={(e) => onContractChange(block.instanceId, e.target.value)}
          placeholder="C..."
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs font-mono text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          aria-describedby={`${block.instanceId}-fn`}
        />
        <p id={`${block.instanceId}-fn`} className="mt-1 text-[10px] text-neutral-500">
          fn: <span className="font-mono">{block.functionName}</span>
        </p>
      </div>

      {/* Arg fields */}
      {block.inputs.length > 0 && (
        <div className="space-y-2">
          {block.inputs.map((param) => (
            <div key={param.name}>
              <label
                htmlFor={`${block.instanceId}-arg-${param.name}`}
                className="block text-[11px] font-medium text-neutral-400 mb-1"
              >
                {param.name}
                <span className="ml-1 text-neutral-600 font-mono text-[10px]">
                  {param.type}
                </span>
                {!param.optional && (
                  <span className="ml-1 text-red-400" aria-label="required">*</span>
                )}
              </label>
              {param.type === 'bool' ? (
                <select
                  id={`${block.instanceId}-arg-${param.name}`}
                  value={block.args[param.name] ?? ''}
                  onChange={(e) => onArgChange(block.instanceId, param.name, e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs font-mono text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">{param.optional ? 'optional' : 'select value'}</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  id={`${block.instanceId}-arg-${param.name}`}
                  type={['u8', 'u16', 'u32', 'u64', 'u128', 'i8', 'i16', 'i32', 'i64', 'i128'].includes(param.type) ? 'number' : 'text'}
                  value={block.args[param.name] ?? ''}
                  onChange={(e) => onArgChange(block.instanceId, param.name, e.target.value)}
                  placeholder={param.optional ? 'optional' : 'required'}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs font-mono text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Config status indicator */}
      <div className="mt-3 flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${block.isConfigured ? 'bg-green-400' : 'bg-yellow-400'}`}
          aria-hidden="true"
        />
        <span className="text-[10px] text-neutral-500">
          {block.isConfigured ? 'Configured' : 'Needs input'}
        </span>
      </div>
    </div>
  );
}
