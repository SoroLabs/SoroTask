import { renderHook, act } from '@testing-library/react';
import { useTemplateBuilder, parseAbi } from '../../template-builder/useTemplateBuilder';
import { ActionDefinition } from '../../template-builder/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HARVEST: ActionDefinition = {
  id: 'harvest-yield',
  label: 'Harvest Yield',
  description: 'Claim yield',
  category: 'defi',
  icon: '🌾',
  functionName: 'harvest',
  defaultContractAddress: 'CAAA',
  inputs: [
    { name: 'pool_id', type: 'address' },
    { name: 'min_amount', type: 'i128', optional: true },
  ],
};

const TRANSFER: ActionDefinition = {
  id: 'token-transfer',
  label: 'Token Transfer',
  description: 'Transfer tokens',
  category: 'transfer',
  icon: '💸',
  functionName: 'transfer',
  inputs: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'i128' },
  ],
};

const NO_INPUT_ACTION: ActionDefinition = {
  id: 'no-inputs',
  label: 'No Inputs',
  description: 'Takes no params',
  category: 'defi',
  icon: '✅',
  functionName: 'noop',
  inputs: [],
};

// ---------------------------------------------------------------------------
// parseAbi tests
// ---------------------------------------------------------------------------

describe('parseAbi', () => {
  it('returns error for non-C address', () => {
    const result = parseAbi('[]', 'GABCDEF');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Contract address/);
  });

  it('returns error for invalid JSON', () => {
    const result = parseAbi('not-json', 'CADDRESS');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid JSON');
  });

  it('parses a bare array of functions', () => {
    const raw = JSON.stringify([
      { name: 'harvest', inputs: [{ name: 'pool_id', type: 'address' }] },
    ]);
    const result = parseAbi(raw, 'CADDRESS', 'My Contract');
    expect(result.success).toBe(true);
    expect(result.abi?.functions).toHaveLength(1);
    expect(result.abi?.contractAddress).toBe('CADDRESS');
    expect(result.abi?.label).toBe('My Contract');
  });

  it('parses an object with a functions key', () => {
    const raw = JSON.stringify({
      contractAddress: 'COLD',
      functions: [{ name: 'vote', inputs: [] }],
    });
    const result = parseAbi(raw, 'CNEW', 'Gov');
    expect(result.success).toBe(true);
    expect(result.abi?.functions[0].name).toBe('vote');
    expect(result.abi?.contractAddress).toBe('CNEW'); // caller address wins
  });

  it('parses Soroban-style ABI objects with typed inputs', () => {
    const raw = JSON.stringify({
      name: 'Counter',
      version: '2',
      functions: [
        {
          name: 'increment',
          inputs: [{ name: 'by', type: { kind: 'u32' } }],
          outputs: [],
        },
      ],
    });
    const result = parseAbi(raw, 'CADDRESS', 'Counter');
    expect(result.success).toBe(true);
    expect(result.abi?.functions[0].inputs[0].type).toBe('u32');
  });

  it('returns error when array items are malformed', () => {
    const result = parseAbi(JSON.stringify([{ notName: 'x' }]), 'CADDR');
    expect(result.success).toBe(false);
  });

  it('returns error for unexpected JSON shape', () => {
    const result = parseAbi(JSON.stringify({ x: 1 }), 'CADDR');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useTemplateBuilder tests
// ---------------------------------------------------------------------------

describe('useTemplateBuilder', () => {
  function setup() {
    return renderHook(() => useTemplateBuilder());
  }

  // --- addBlock ---

  it('starts empty', () => {
    const { result } = setup();
    expect(result.current.blocks).toHaveLength(0);
    expect(result.current.isValid).toBe(false);
  });

  it('adds a block from a definition', () => {
    const { result } = setup();
    act(() => result.current.addBlock(HARVEST));
    expect(result.current.blocks).toHaveLength(1);
    const block = result.current.blocks[0];
    expect(block.functionName).toBe('harvest');
    expect(block.contractAddress).toBe('CAAA');
    expect(block.isConfigured).toBe(false); // pool_id is required and empty
  });

  it('marks block as configured when all required inputs are pre-filled', () => {
    const { result } = setup();
    act(() => result.current.addBlock(NO_INPUT_ACTION));
    expect(result.current.blocks[0].isConfigured).toBe(true);
  });

  it('generates unique instanceIds for multiple adds', () => {
    const { result } = setup();
    act(() => {
      result.current.addBlock(HARVEST);
      result.current.addBlock(HARVEST);
    });
    const ids = result.current.blocks.map((b) => b.instanceId);
    expect(new Set(ids).size).toBe(2);
  });

  // --- removeBlock ---

  it('removes a block by instanceId', () => {
    const { result } = setup();
    act(() => result.current.addBlock(HARVEST));
    const id = result.current.blocks[0].instanceId;
    act(() => result.current.removeBlock(id));
    expect(result.current.blocks).toHaveLength(0);
  });

  it('no-ops remove for unknown id', () => {
    const { result } = setup();
    act(() => result.current.addBlock(HARVEST));
    act(() => result.current.removeBlock('nonexistent'));
    expect(result.current.blocks).toHaveLength(1);
  });

  // --- reorderBlocks ---

  it('reorders blocks', () => {
    const { result } = setup();
    act(() => {
      result.current.addBlock(HARVEST);
      result.current.addBlock(TRANSFER);
    });
    const [id0, id1] = result.current.blocks.map((b) => b.instanceId);
    act(() => result.current.reorderBlocks(0, 1));
    expect(result.current.blocks[0].instanceId).toBe(id1);
    expect(result.current.blocks[1].instanceId).toBe(id0);
  });

  it('no-ops reorder when fromIndex equals toIndex', () => {
    const { result } = setup();
    act(() => {
      result.current.addBlock(HARVEST);
      result.current.addBlock(TRANSFER);
    });
    const before = result.current.blocks.map((b) => b.instanceId);
    act(() => result.current.reorderBlocks(0, 0));
    expect(result.current.blocks.map((b) => b.instanceId)).toEqual(before);
  });

  // --- updateArg ---

  it('updates an arg and recalculates isConfigured', () => {
    const { result } = setup();
    act(() => result.current.addBlock(HARVEST));
    const id = result.current.blocks[0].instanceId;

    expect(result.current.blocks[0].isConfigured).toBe(false);

    act(() => result.current.updateArg(id, 'pool_id', 'CPOOL'));
    expect(result.current.blocks[0].args['pool_id']).toBe('CPOOL');
    expect(result.current.blocks[0].isConfigured).toBe(true);
  });

  it('ignores update for unknown instanceId', () => {
    const { result } = setup();
    act(() => result.current.addBlock(HARVEST));
    act(() => result.current.updateArg('ghost', 'pool_id', 'X'));
    expect(result.current.blocks[0].args['pool_id']).toBeUndefined();
  });

  it('requires valid values for typed numeric inputs', () => {
    const { result } = setup();
    act(() =>
      result.current.addBlock({
        ...HARVEST,
        inputs: [{ name: 'amount', type: 'u64' }],
      }),
    );
    const id = result.current.blocks[0].instanceId;

    act(() => result.current.updateArg(id, 'amount', 'not-a-number'));
    expect(result.current.blocks[0].isConfigured).toBe(false);

    act(() => result.current.updateArg(id, 'amount', '42'));
    expect(result.current.blocks[0].isConfigured).toBe(true);
  });

  // --- updateContractAddress ---

  it('updates the contract address of a block', () => {
    const { result } = setup();
    act(() => result.current.addBlock(HARVEST));
    const id = result.current.blocks[0].instanceId;
    act(() => result.current.updateContractAddress(id, 'CNEW'));
    expect(result.current.blocks[0].contractAddress).toBe('CNEW');
  });

  // --- setTemplateName ---

  it('sets the template name', () => {
    const { result } = setup();
    act(() => result.current.setTemplateName('My Flow'));
    expect(result.current.templateName).toBe('My Flow');
  });

  // --- isValid ---

  it('isValid requires name + at least one block + all configured', () => {
    const { result } = setup();

    // No name, no blocks
    expect(result.current.isValid).toBe(false);

    act(() => result.current.setTemplateName('Flow'));
    // Name but no blocks
    expect(result.current.isValid).toBe(false);

    act(() => result.current.addBlock(NO_INPUT_ACTION));
    // Name + configured block
    expect(result.current.isValid).toBe(true);
  });

  it('isValid is false when any block is unconfigured', () => {
    const { result } = setup();
    act(() => {
      result.current.setTemplateName('Flow');
      result.current.addBlock(HARVEST); // requires pool_id
    });
    expect(result.current.isValid).toBe(false);
  });

  // --- importAbi ---

  it('imports an ABI and appends to importedAbis', () => {
    const { result } = setup();
    const raw = JSON.stringify([{ name: 'fn1', inputs: [] }]);
    let res: ReturnType<typeof result.current.importAbi>;
    act(() => {
      res = result.current.importAbi(raw, 'CCONTRACT', 'MyABI');
    });
    expect(res!.success).toBe(true);
    expect(result.current.importedAbis).toHaveLength(1);
    expect(result.current.importedAbis[0].contractAddress).toBe('CCONTRACT');
  });

  it('returns error result and does not modify state on bad ABI', () => {
    const { result } = setup();
    let res: ReturnType<typeof result.current.importAbi>;
    act(() => {
      res = result.current.importAbi('bad json', 'CADDR');
    });
    expect(res!.success).toBe(false);
    expect(result.current.importedAbis).toHaveLength(0);
  });

  it('replaces existing ABI for same contract address', () => {
    const { result } = setup();
    const raw1 = JSON.stringify([{ name: 'fn1', inputs: [] }]);
    const raw2 = JSON.stringify([{ name: 'fn2', inputs: [] }]);
    act(() => {
      result.current.importAbi(raw1, 'CCONTRACT');
      result.current.importAbi(raw2, 'CCONTRACT');
    });
    expect(result.current.importedAbis).toHaveLength(1);
    expect(result.current.importedAbis[0].functions[0].name).toBe('fn2');
  });

  // --- buildTemplate ---

  it('buildTemplate returns a FlowTemplate with current state', () => {
    const { result } = setup();
    act(() => {
      result.current.setTemplateName('My Template');
      result.current.addBlock(NO_INPUT_ACTION);
    });
    let template: ReturnType<typeof result.current.buildTemplate>;
    act(() => {
      template = result.current.buildTemplate();
    });
    expect(template!.name).toBe('My Template');
    expect(template!.blocks).toHaveLength(1);
    expect(template!.id).toMatch(/^template-/);
    expect(template!.createdAt).toBeInstanceOf(Date);
  });

  it('buildTemplate uses "Untitled Template" when name is empty', () => {
    const { result } = setup();
    let template: ReturnType<typeof result.current.buildTemplate>;
    act(() => {
      template = result.current.buildTemplate();
    });
    expect(template!.name).toBe('Untitled Template');
  });

  // --- reset ---

  it('reset clears all state', () => {
    const { result } = setup();
    act(() => {
      result.current.setTemplateName('Flow');
      result.current.addBlock(HARVEST);
      result.current.importAbi(JSON.stringify([{ name: 'fn', inputs: [] }]), 'CADDR');
    });
    act(() => result.current.reset());
    expect(result.current.blocks).toHaveLength(0);
    expect(result.current.templateName).toBe('');
    expect(result.current.importedAbis).toHaveLength(0);
  });
});
