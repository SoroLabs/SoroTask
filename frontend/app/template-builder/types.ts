/**
 * Types for the Interactive Task Template Builder (#405)
 */

// ---------------------------------------------------------------------------
// ABI types (subset of Soroban contract spec)
// ---------------------------------------------------------------------------

export type AbiParamType =
  | 'address'
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'u128'
  | 'i8'
  | 'i16'
  | 'i32'
  | 'i64'
  | 'i128'
  | 'bool'
  | 'string'
  | 'bytes'
  | 'symbol'
  | 'void';

export interface AbiParam {
  name: string;
  type: AbiParamType;
  optional?: boolean;
}

export interface AbiFunction {
  name: string;
  doc?: string;
  inputs: AbiParam[];
}

export interface ContractAbi {
  contractAddress: string;
  label?: string;
  functions: AbiFunction[];
}

// ---------------------------------------------------------------------------
// Action block (one step in the flow)
// ---------------------------------------------------------------------------

export type ActionCategory = 'defi' | 'transfer' | 'governance' | 'custom';

/** A definition of a reusable action (comes from the palette) */
export interface ActionDefinition {
  id: string;
  label: string;
  description: string;
  category: ActionCategory;
  icon: string;
  /** Pre-filled contract address for pre-defined actions */
  defaultContractAddress?: string;
  /** Function name this action maps to */
  functionName: string;
  /** Param schema */
  inputs: AbiParam[];
}

/** A single block placed on the canvas, with user-supplied values */
export interface ActionBlock {
  /** Unique instance id on the canvas */
  instanceId: string;
  /** Source definition id */
  definitionId: string;
  label: string;
  category: ActionCategory;
  icon: string;
  contractAddress: string;
  functionName: string;
  inputs: AbiParam[];
  /** User-supplied argument values keyed by param name */
  args: Record<string, string>;
  /** Whether this block has been fully configured */
  isConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Flow template
// ---------------------------------------------------------------------------

export interface FlowTemplate {
  id: string;
  name: string;
  description?: string;
  blocks: ActionBlock[];
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Drag state
// ---------------------------------------------------------------------------

export type DragSource = 'palette' | 'canvas';

export interface DragPayload {
  source: DragSource;
  /** For palette drags: the ActionDefinition id */
  definitionId?: string;
  /** For canvas reorder drags: the ActionBlock instanceId */
  instanceId?: string;
}

// ---------------------------------------------------------------------------
// ABI parse result
// ---------------------------------------------------------------------------

export interface AbiParseResult {
  success: boolean;
  abi?: ContractAbi;
  error?: string;
}
