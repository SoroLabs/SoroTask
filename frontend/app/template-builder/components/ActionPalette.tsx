'use client';

import React, { useState } from 'react';
import { ActionDefinition, AbiFunction, AbiParseResult, ContractAbi } from '../types';
import { PREDEFINED_ACTIONS } from '../actions';

const CATEGORY_TABS = ['all', 'defi', 'transfer', 'governance', 'custom'] as const;
type TabFilter = (typeof CATEGORY_TABS)[number];

interface ActionPaletteProps {
  importedAbis: ContractAbi[];
  onAddBlock: (def: ActionDefinition) => void;
  onImportAbi: (raw: string, address: string, label?: string) => AbiParseResult;
}

export function ActionPalette({
  importedAbis,
  onAddBlock,
  onImportAbi,
}: ActionPaletteProps) {
  const [tab, setTab] = useState<TabFilter>('all');
  const [abiJson, setAbiJson] = useState('');
  const [abiAddress, setAbiAddress] = useState('');
  const [abiLabel, setAbiLabel] = useState('');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState(false);

  // Build the full action list: pre-defined + ABI-derived custom actions
  const customActions: ActionDefinition[] = importedAbis.flatMap((abi) =>
    abi.functions.map((fn: AbiFunction) => ({
      id: `custom-${abi.contractAddress}-${fn.name}`,
      label: fn.name,
      description: fn.doc ?? `Custom: ${abi.label ?? abi.contractAddress}`,
      category: 'custom' as const,
      icon: '⚙️',
      functionName: fn.name,
      defaultContractAddress: abi.contractAddress,
      inputs: fn.inputs,
    })),
  );

  const allActions = [...PREDEFINED_ACTIONS, ...customActions];
  const filtered =
    tab === 'all' ? allActions : allActions.filter((a) => a.category === tab);

  function handleDragStart(
    e: React.DragEvent<HTMLButtonElement>,
    definitionId: string,
  ) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/x-definition-id', definitionId);
  }

  function handleImport() {
    setImportError('');
    setImportSuccess(false);
    if (!abiJson.trim()) {
      setImportError('Paste your ABI JSON first.');
      return;
    }
    const result = onImportAbi(abiJson, abiAddress, abiLabel || undefined);
    if (!result.success) {
      setImportError(result.error ?? 'Import failed');
    } else {
      setImportSuccess(true);
      setAbiJson('');
    }
  }

  return (
    <aside
      aria-label="Action palette"
      className="flex flex-col h-full bg-neutral-900 border-r border-neutral-800 w-64 shrink-0 overflow-hidden"
    >
      {/* Category tabs */}
      <div className="flex gap-0.5 px-2 pt-3 pb-2 flex-wrap">
        {CATEGORY_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors capitalize ${
              tab === t
                ? 'bg-blue-600 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Action list */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1.5 pb-2">
        {filtered.length === 0 && (
          <p className="text-xs text-neutral-500 text-center py-8">
            No actions in this category.
          </p>
        )}
        {filtered.map((action) => (
          <button
            key={action.id}
            type="button"
            draggable
            aria-label={`Add ${action.label} action`}
            data-testid={`palette-action-${action.id}`}
            onClick={() => onAddBlock(action)}
            onDragStart={(e) => handleDragStart(e, action.id)}
            className="w-full text-left flex items-start gap-3 p-3 rounded-lg border border-transparent hover:border-neutral-700 hover:bg-neutral-800 transition-colors group cursor-grab active:cursor-grabbing"
          >
            <span className="text-xl mt-0.5 shrink-0" aria-hidden="true">
              {action.icon}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-neutral-200 truncate">
                {action.label}
              </p>
              <p className="text-[10px] text-neutral-500 line-clamp-2 leading-snug mt-0.5">
                {action.description}
              </p>
            </div>
            <span
              className="ml-auto text-neutral-600 group-hover:text-blue-400 transition-colors text-lg leading-none shrink-0"
              aria-hidden="true"
            >
              +
            </span>
          </button>
        ))}
      </div>

      {/* ABI import panel */}
      <div className="border-t border-neutral-800 px-3 py-3 space-y-2">
        <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
          Import Custom ABI
        </p>
        <input
          type="text"
          value={abiAddress}
          onChange={(e) => setAbiAddress(e.target.value)}
          placeholder="Contract address C..."
          aria-label="Contract address for ABI import"
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs font-mono text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <input
          type="text"
          value={abiLabel}
          onChange={(e) => setAbiLabel(e.target.value)}
          placeholder="Label (optional)"
          aria-label="Label for imported ABI"
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <textarea
          value={abiJson}
          onChange={(e) => {
            setAbiJson(e.target.value);
            setImportError('');
            setImportSuccess(false);
          }}
          placeholder={'[\n  { "name": "fn", "inputs": [] }\n]'}
          aria-label="ABI JSON"
          rows={4}
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-[11px] font-mono text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500 resize-none"
        />
        {importError && (
          <p role="alert" className="text-[11px] text-red-400">
            {importError}
          </p>
        )}
        {importSuccess && (
          <p role="status" className="text-[11px] text-green-400">
            ABI imported — actions added to Custom tab.
          </p>
        )}
        <button
          type="button"
          onClick={handleImport}
          className="w-full py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
        >
          Import
        </button>
      </div>
    </aside>
  );
}
