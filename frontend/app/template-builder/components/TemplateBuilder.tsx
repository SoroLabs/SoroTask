'use client';

import React, { useState, useCallback } from 'react';
import { useTemplateBuilder } from '../useTemplateBuilder';
import { ActionPalette } from './ActionPalette';
import { FlowCanvas } from './FlowCanvas';
import { PREDEFINED_ACTIONS } from '../actions';
import { ActionDefinition, FlowTemplate } from '../types';

interface TemplateBuilderProps {
  /** Called when the user submits a valid template */
  onSubmit?: (template: FlowTemplate) => void;
}

export function TemplateBuilder({ onSubmit }: TemplateBuilderProps) {
  const {
    blocks,
    templateName,
    importedAbis,
    isValid,
    addBlock,
    removeBlock,
    reorderBlocks,
    updateArg,
    updateContractAddress,
    setTemplateName,
    importAbi,
    buildTemplate,
    reset,
  } = useTemplateBuilder();

  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  /** Resolve a definition id → ActionDefinition from pre-defined or ABI-derived list */
  const resolveDefinition = useCallback(
    (definitionId: string): ActionDefinition | undefined => {
      const pre = PREDEFINED_ACTIONS.find((a) => a.id === definitionId);
      if (pre) return pre;
      // ABI-derived ids: "custom-{address}-{fnName}"
      for (const abi of importedAbis) {
        for (const fn of abi.functions) {
          if (`custom-${abi.contractAddress}-${fn.name}` === definitionId) {
            return {
              id: definitionId,
              label: fn.name,
              description: fn.doc ?? `${abi.label ?? abi.contractAddress}.${fn.name}`,
              category: 'custom',
              icon: '⚙️',
              functionName: fn.name,
              defaultContractAddress: abi.contractAddress,
              inputs: fn.inputs,
            };
          }
        }
      }
      return undefined;
    },
    [importedAbis],
  );

  function handleDropDefinition(definitionId: string) {
    const def = resolveDefinition(definitionId);
    if (def) {
      handleAddBlockFromDef(def);
    }
  }

  function handleAddBlockFromDef(def: any) {
    addBlock({
        instanceId: `block-${Date.now()}`,
        definitionId: def.id,
        label: def.label,
        category: def.category,
        icon: def.icon,
        contractAddress: def.defaultContractAddress ?? '',
        functionName: def.functionName,
        inputs: def.inputs,
        args: {},
        isConfigured: def.inputs.filter((p: any) => !p.optional).length === 0,
      });
  }

  function handleSubmit() {
    if (!isValid) {
      setSubmitError(
        'Fill in the template name and configure all blocks before submitting.',
      );
      return;
    }
    setSubmitError('');
    const template = buildTemplate();
    
    // Save to localStorage
    try {
      const existing = JSON.parse(window.localStorage.getItem('sorotask.templates') || '[]');
      existing.push(template);
      window.localStorage.setItem('sorotask.templates', JSON.stringify(existing));
    } catch (e) {
      console.error("Failed to save template", e);
    }

    setSubmitted(true);
    onSubmit?.(template);
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
        <div
          className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center text-3xl"
          aria-hidden="true"
        >
          ✅
        </div>
        <h2 className="text-xl font-semibold text-neutral-100">
          Template registered!
        </h2>
        <p className="text-sm text-neutral-400 max-w-xs">
          Your flow template has been submitted and is ready for use.
        </p>
        <button
          type="button"
          onClick={() => {
            reset();
            setSubmitted(false);
          }}
          className="mt-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg text-sm font-medium text-neutral-200 transition-colors"
        >
          Build another
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-neutral-800 bg-neutral-900 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl" aria-hidden="true">🛠️</span>
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Template name…"
            aria-label="Template name"
            className="bg-transparent border-b border-neutral-700 focus:border-blue-500 outline-none text-neutral-100 text-sm font-semibold w-52 pb-0.5 placeholder-neutral-600 transition-colors"
          />
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Block count badge */}
          {blocks.length > 0 && (
            <span className="text-xs text-neutral-400 font-medium bg-neutral-800 px-2 py-0.5 rounded-full">
              {blocks.length} step{blocks.length !== 1 ? 's' : ''}
            </span>
          )}
          <button
            type="button"
            onClick={reset}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors px-2 py-1"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid}
            aria-disabled={!isValid}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save Template
          </button>
        </div>
      </header>

      {/* Error banner */}
      {submitError && (
        <div
          role="alert"
          className="mx-6 mt-3 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 flex items-center justify-between"
        >
          <span>{submitError}</span>
          <button
            type="button"
            onClick={() => setSubmitError('')}
            className="ml-4 text-red-400/60 hover:text-red-400 text-lg leading-none"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Main layout: palette left, canvas right */}
      <div className="flex flex-1 overflow-hidden">
        <ActionPalette
          importedAbis={importedAbis}
          onAddBlock={handleAddBlockFromDef}
          onImportAbi={importAbi}
        />
        <FlowCanvas
          blocks={blocks}
          onAddBlock={handleAddBlockFromDef}
          onRemoveBlock={removeBlock}
          onArgChange={updateArg}
          onContractChange={updateContractAddress}
          onReorder={reorderBlocks}
          onDropDefinition={handleDropDefinition}
        />
      </div>
    </div>
  );
}
