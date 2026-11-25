'use client';

import { useReducer, useCallback } from 'react';
import {
  ActionBlock,
  ActionDefinition,
  ContractAbi,
  AbiFunction,
  AbiParseResult,
  FlowTemplate,
  AbiParam,
  AbiParamType,
} from './types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TemplateBuilderState {
  blocks: ActionBlock[];
  templateName: string;
  importedAbis: ContractAbi[];
  errors: Record<string, string>; // instanceId → error message
}

const KNOWN_PARAM_TYPES: AbiParamType[] = [
  'address',
  'u8',
  'u16',
  'u32',
  'u64',
  'u128',
  'i8',
  'i16',
  'i32',
  'i64',
  'i128',
  'bool',
  'string',
  'bytes',
  'symbol',
  'void',
];

function normalizeAbiType(rawType: unknown): AbiParamType {
  if (typeof rawType === 'string') {
    return (KNOWN_PARAM_TYPES.includes(rawType as AbiParamType)
      ? (rawType as AbiParamType)
      : 'string') as AbiParamType;
  }

  if (typeof rawType === 'object' && rawType !== null) {
    const candidate = rawType as Record<string, unknown>;
    const nested = candidate.kind ?? candidate.type ?? candidate.name;
    if (typeof nested === 'string') {
      return normalizeAbiType(nested);
    }
  }

  return 'string';
}

function normalizeAbiParam(param: unknown): AbiParam | null {
  if (!param || typeof param !== 'object') return null;

  const candidate = param as Record<string, unknown>;
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  if (!name) return null;

  return {
    name,
    type: normalizeAbiType(candidate.type),
    optional: candidate.optional === true,
  };
}

function isArgConfigured(value: string | undefined, param: AbiParam): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return param.optional === true;
  }

  switch (param.type) {
    case 'bool':
      return ['true', 'false', '1', '0'].includes(trimmed.toLowerCase());
    case 'u8':
    case 'u16':
    case 'u32':
    case 'u64':
    case 'u128':
      return /^\d+$/.test(trimmed);
    case 'i8':
    case 'i16':
    case 'i32':
    case 'i64':
    case 'i128':
      return /^-?\d+$/.test(trimmed);
    case 'address':
      return trimmed.startsWith('C') || /^G[A-Z2-7]{55}$/.test(trimmed);
    default:
      return true;
  }
}

function isBlockConfigured(block: ActionBlock): boolean {
  return block.inputs
    .filter((param) => !param.optional)
    .every((param) => isArgConfigured(block.args[param.name], param));
}

const initialState: TemplateBuilderState = {
  blocks: [],
  templateName: '',
  importedAbis: [],
  errors: {},
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: 'ADD_BLOCK'; block: ActionBlock }
  | { type: 'REMOVE_BLOCK'; instanceId: string }
  | { type: 'REORDER_BLOCKS'; fromIndex: number; toIndex: number }
  | { type: 'UPDATE_BLOCK_ARG'; instanceId: string; argName: string; value: string }
  | { type: 'UPDATE_BLOCK_CONTRACT'; instanceId: string; contractAddress: string }
  | { type: 'SET_TEMPLATE_NAME'; name: string }
  | { type: 'IMPORT_ABI'; abi: ContractAbi }
  | { type: 'SET_ERROR'; instanceId: string; error: string }
  | { type: 'CLEAR_ERROR'; instanceId: string }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: TemplateBuilderState, action: Action): TemplateBuilderState {
  switch (action.type) {
    case 'ADD_BLOCK':
      return { ...state, blocks: [...state.blocks, action.block] };

    case 'REMOVE_BLOCK': {
      const { [action.instanceId]: _, ...rest } = state.errors;
      return {
        ...state,
        blocks: state.blocks.filter((b) => b.instanceId !== action.instanceId),
        errors: rest,
      };
    }

    case 'REORDER_BLOCKS': {
      const blocks = [...state.blocks];
      const [moved] = blocks.splice(action.fromIndex, 1);
      blocks.splice(action.toIndex, 0, moved);
      return { ...state, blocks };
    }

    case 'UPDATE_BLOCK_ARG': {
      const blocks = state.blocks.map((b) => {
        if (b.instanceId !== action.instanceId) return b;
        const args = { ...b.args, [action.argName]: action.value };
        const isConfigured = isBlockConfigured({ ...b, args });
        return { ...b, args, isConfigured };
      });
      return { ...state, blocks };
    }

    case 'UPDATE_BLOCK_CONTRACT': {
      const blocks = state.blocks.map((b) =>
        b.instanceId === action.instanceId
          ? { ...b, contractAddress: action.contractAddress }
          : b,
      );
      return { ...state, blocks };
    }

    case 'SET_TEMPLATE_NAME':
      return { ...state, templateName: action.name };

    case 'IMPORT_ABI': {
      // Replace existing abi for same address, or append
      const existing = state.importedAbis.findIndex(
        (a) => a.contractAddress === action.abi.contractAddress,
      );
      const importedAbis =
        existing >= 0
          ? state.importedAbis.map((a, i) => (i === existing ? action.abi : a))
          : [...state.importedAbis, action.abi];
      return { ...state, importedAbis };
    }

    case 'SET_ERROR':
      return { ...state, errors: { ...state.errors, [action.instanceId]: action.error } };

    case 'CLEAR_ERROR': {
      const { [action.instanceId]: _, ...rest } = state.errors;
      return { ...state, errors: rest };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// ABI parser — parses a JSON string that is either a ContractAbi or
// an array of AbiFunction[] (bare function list).
// ---------------------------------------------------------------------------

export function parseAbi(
  raw: string,
  contractAddress: string,
  label?: string,
): AbiParseResult {
  if (!contractAddress.startsWith('C')) {
    return { success: false, error: 'Contract address must start with "C"' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { success: false, error: 'Invalid JSON' };
  }

  // Accept bare array of functions
  if (Array.isArray(parsed)) {
    const fns = parsed as AbiFunction[];
    if (!fns.every((f) => typeof f.name === 'string' && Array.isArray(f.inputs))) {
      return { success: false, error: 'Array items must have name and inputs fields' };
    }
    const normalizedFunctions = fns.map((fn) => ({
      ...fn,
      inputs: (fn.inputs ?? [])
        .map(normalizeAbiParam)
        .filter((param): param is AbiParam => param !== null),
    }));
    return { success: true, abi: { contractAddress, label, functions: normalizedFunctions } };
  }

  // Accept ContractAbi object
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'functions' in parsed &&
    Array.isArray((parsed as ContractAbi).functions)
  ) {
    const obj = parsed as ContractAbi;
    const normalizedFunctions = (obj.functions ?? []).map((fn) => ({
      ...fn,
      inputs: (fn.inputs ?? [])
        .map(normalizeAbiParam)
        .filter((param): param is AbiParam => param !== null),
    }));
    return {
      success: true,
      abi: { contractAddress, label, functions: normalizedFunctions },
    };
  }

  return {
    success: false,
    error: 'Expected an array of functions or an object with a "functions" key',
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

let instanceCounter = 0;

function makeInstanceId(): string {
  return `block-${Date.now()}-${++instanceCounter}`;
}

export function useTemplateBuilder() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const addBlock = useCallback((input: ActionBlock | ActionDefinition) => {
    let block: ActionBlock;
    if ('definitionId' in input) {
      block = input;
    } else {
      const def = input as ActionDefinition;
      const args: Record<string, string> = {};
      const isConfigured = def.inputs.filter((p) => !p.optional).length === 0;
      block = {
        instanceId: makeInstanceId(),
        definitionId: def.id,
        label: def.label,
        category: def.category,
        icon: def.icon,
        contractAddress: def.defaultContractAddress ?? '',
        functionName: def.functionName,
        inputs: def.inputs,
        args,
        isConfigured,
      };
    }
    dispatch({ type: 'ADD_BLOCK', block });
  }, []);

  const removeBlock = useCallback((instanceId: string) => {
    dispatch({ type: 'REMOVE_BLOCK', instanceId });
  }, []);

  const reorderBlocks = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    dispatch({ type: 'REORDER_BLOCKS', fromIndex, toIndex });
  }, []);

  const updateArg = useCallback(
    (instanceId: string, argName: string, value: string) => {
      dispatch({ type: 'UPDATE_BLOCK_ARG', instanceId, argName, value });
    },
    [],
  );

  const updateContractAddress = useCallback(
    (instanceId: string, contractAddress: string) => {
      dispatch({ type: 'UPDATE_BLOCK_CONTRACT', instanceId, contractAddress });
    },
    [],
  );

  const setTemplateName = useCallback((name: string) => {
    dispatch({ type: 'SET_TEMPLATE_NAME', name });
  }, []);

  const importAbi = useCallback(
    (raw: string, contractAddress: string, label?: string): AbiParseResult => {
      const result = parseAbi(raw, contractAddress, label);
      if (result.success && result.abi) {
        dispatch({ type: 'IMPORT_ABI', abi: result.abi });
      }
      return result;
    },
    [],
  );

  const buildTemplate = useCallback((): FlowTemplate => {
    return {
      id: `template-${Date.now()}`,
      name: state.templateName || 'Untitled Template',
      blocks: state.blocks,
      createdAt: new Date(),
    };
  }, [state.templateName, state.blocks]);

  const isValid =
    state.templateName.trim().length > 0 &&
    state.blocks.length > 0 &&
    state.blocks.every((b) => b.isConfigured);

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return {
    blocks: state.blocks,
    templateName: state.templateName,
    importedAbis: state.importedAbis,
    errors: state.errors,
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
  };
}
