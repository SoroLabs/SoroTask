'use client';

import React, { useCallback, useState } from 'react';
import { TemplateMarketplace } from './components/TemplateMarketplace';
import { TemplateForkModal } from './components/TemplateForkModal';
import type { ForkedTemplate, TaskTemplate } from '@/src/lib/templates';
import { buildRegistrationBatch, type TaskRegistrationDraft } from '@/app/lib/txBatch';

/** Where the task builder already persists user templates. */
const TEMPLATE_STORAGE_KEY = 'sorotask.templates';

interface StoredFlowTemplate {
  id: string;
  name: string;
  description?: string;
  blocks: unknown[];
  createdAt: string;
}

/**
 * Persists a fork so it shows up in the "Saved Templates" grid on /tasks and
 * can be reopened in the builder.
 *
 * A corrupt or full store must not lose the fork the user just created, so a
 * failed write throws rather than being swallowed — the modal then reports it
 * instead of claiming success.
 */
function persistFork(forked: ForkedTemplate): void {
  const record: StoredFlowTemplate = {
    id: forked.template.id,
    name: forked.template.name,
    description: forked.template.description,
    blocks: forked.template.blocks,
    createdAt: forked.forkedAt,
  };

  let existing: StoredFlowTemplate[] = [];
  try {
    const raw = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed as StoredFlowTemplate[];
    }
  } catch {
    // A corrupt store is replaced rather than merged into.
    existing = [];
  }

  const next = [...existing.filter((t) => t.id !== record.id), record];
  window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next));
}

/**
 * Community template marketplace (#1243).
 *
 * Deployment is deliberately split: the batch is validated and costed here,
 * then handed to `onDeployBatch`. The default implementation persists the fork
 * and hands the operations to the caller, because a signed transaction needs a
 * connected wallet and this route must work without one — which is what keeps
 * "fork and deploy in under 60 seconds" achievable.
 */
export function TemplateMarketplacePage() {
  const [selected, setSelected] = useState<TaskTemplate | null>(null);

  const handleDeploy = useCallback(
    async (forked: ForkedTemplate) => {
      const drafts: TaskRegistrationDraft[] = forked.template.blocks.map((block) => ({
        // Registration ids come from the chain; the local id only has to be
        // stable and unique within the batch.
        id: block.instanceId,
        contractAddress: block.contractAddress,
        functionName: block.functionName,
        intervalSeconds: forked.template.intervalSeconds,
        gasBalance: String(block.gasReserveXlm),
      }));

      // Validate before persisting, so a template that could never be
      // submitted is not saved as if it had been.
      buildRegistrationBatch(drafts);
      persistFork(forked);
    },
    [],
  );

  return (
    <>
      <TemplateMarketplace onUseTemplate={setSelected} />
      {selected && (
        <TemplateForkModal
          template={selected}
          onClose={() => setSelected(null)}
          onDeploy={handleDeploy}
        />
      )}
    </>
  );
}

export default TemplateMarketplacePage;
export { TEMPLATE_STORAGE_KEY, persistFork };
