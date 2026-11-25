import { z } from "zod";

/** Soroban WASM primitive types */
export type SorobanScType =
  | "u32"
  | "i32"
  | "u64"
  | "i64"
  | "u128"
  | "i128"
  | "u256"
  | "i256"
  | "bool"
  | "string"
  | "bytes"
  | "bytesN"
  | "address"
  | "noncekey"
  | "void";

/** Complex types from ScSpec - arrays, tuples, maps, vectors */
export interface ScSpecVectorType {
  type: "vec";
  elementType: SorobanScType | ScSpecTypeDef;
}

export interface ScSpecMapType {
  type: "map";
  keyType: SorobanScType | ScSpecTypeDef;
  valueType: SorobanScType | ScSpecTypeDef;
}

export interface ScSpecArrayType {
  type: "array";
  elementType: SorobanScType | ScSpecTypeDef;
  size: number;
}

export interface ScSpecOptionType {
  type: "option";
  innerType: SorobanScType | ScSpecTypeDef;
}

export interface ScSpecTupleType {
  type: "tuple";
  elements: Array<SorobanScType | ScSpecTypeDef>;
}

export type ScSpecTypeDef = 
  | SorobanScType 
  | ScSpecVectorType 
  | ScSpecMapType 
  | ScSpecArrayType 
  | ScSpecOptionType 
  | ScSpecTupleType;

export interface AbiParam {
  name: string;
  type: SorobanScType;
  specType?: ScSpecTypeDef;
  optional?: boolean;
}

export interface AbiFunction {
  name: string;
  inputs: AbiParam[];
  outputs: AbiParam[];
  doc?: string;
}

export interface ContractAbi {
  contractId: string;
  functions: AbiFunction[];
}

export type FormFieldValue = string | boolean | unknown[] | Record<string, unknown>;

export interface AbiFormField {
  param: AbiParam;
  value: FormFieldValue;
  error: string | null;
}

export interface AbiFormState {
  fields: Record<string, AbiFormField>;
  isValid: boolean;
}

/** Zod schemas for each Soroban type */
const schemas: Record<SorobanScType, z.ZodType<unknown>> = {
  u32: z.number().int().min(0).max(4294967295),
  i32: z.number().int().min(-2147483648).max(2147483647),
  u64: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  i64: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  u128: z.string().regex(/^\d+$/, "Must be non-negative integer").transform(Number),
  i128: z.string().regex(/^-?\d+$/, "Must be integer").transform(Number),
  u256: z.string().regex(/^\d+$/, "Must be non-negative integer"),
  i256: z.string().regex(/^-?\d+$/, "Must be integer"),
  bool: z.boolean(),
  string: z.string(),
  bytes: z.string().regex(/^[0-9a-fA-F]*$/, "Must be hex string"),
  bytesN: z.string().regex(/^[0-9a-fA-F]+$/, "Must be hex string"),
  address: z.string().regex(/^[GC][A-Z2-7]{55}$/, "Invalid Stellar address"),
  noncekey: z.string().regex(/^[GC][A-Z2-7]{55}$/, "Invalid Stellar address"),
  void: z.any(),
};

/** Get Zod schema for a parameter */
export function getZodSchema(param: AbiParam): z.ZodType<unknown> {
  if (param.specType) {
    return getSpecTypeSchema(param.specType);
  }
  return schemas[param.type] || z.string();
}

function getSpecTypeSchema(spec: ScSpecTypeDef): z.ZodType<unknown> {
  if (typeof spec === "string") {
    return schemas[spec] || z.string();
  }
  
  switch (spec.type) {
    case "vec":
      return z.array(getSpecTypeSchema(spec.elementType as ScSpecTypeDef));
    case "map":
      return z.record(
        z.string(), // keys are strings for form
        getSpecTypeSchema(spec.valueType as ScSpecTypeDef)
      );
    case "array":
      return z.array(getSpecTypeSchema(spec.elementType as ScSpecTypeDef)).min(spec.size).max(spec.size);
    case "option":
      return z.union([getSpecTypeSchema(spec.innerType as ScSpecTypeDef), z.null()]);
    case "tuple":
      return z.tuple(spec.elements.map(e => getSpecTypeSchema(e as ScSpecTypeDef)));
    default:
      return z.string();
  }
}

function validateValueWithZod(value: FormFieldValue, param: AbiParam): string | null {
  if (param.optional && (value === "" || value === null || value === undefined)) {
    return null;
  }

  if (param.type === "bool") return null;

  const str = String(value).trim();
  if (!str) return `${param.name} is required`;

  try {
    const schema = getZodSchema(param);
    // For strings, parse as the appropriate type
    if (typeof value === "string" && param.type !== "string" && param.type !== "bytes" && param.type !== "bytesN" && param.type !== "address") {
      const parsed = schema.parse(Number(value));
      return null;
    }
    schema.parse(value);
    return null;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return e.errors[0]?.message || "Invalid value";
    }
    return "Invalid value";
  }
}

/** Legacy validation for backwards compatibility */
function validateValue(value: FormFieldValue, param: AbiParam): string | null {
  return validateValueWithZod(value, param);
}

export function buildInitialFormState(fn: AbiFunction): AbiFormState {
  const fields: Record<string, AbiFormField> = {};
  for (const param of fn.inputs) {
    fields[param.name] = {
      param,
      value: param.type === "bool" ? false : "",
      error: null,
    };
  }
  return { fields, isValid: fn.inputs.length === 0 };
}

export function updateField(
  state: AbiFormState,
  name: string,
  value: FormFieldValue,
): AbiFormState {
  const field = state.fields[name];
  if (!field) return state;

  const error = validateValue(value, field.param);
  const updated = { ...state.fields, [name]: { ...field, value, error } };
  const isValid = Object.values(updated).every((f) => f.error === null && (f.param.optional || f.value !== ""));

  return { fields: updated, isValid };
}

export function validateAll(state: AbiFormState): AbiFormState {
  const fields: Record<string, AbiFormField> = {};
  for (const [name, field] of Object.entries(state.fields)) {
    const error = validateValue(field.value, field.param);
    fields[name] = { ...field, error };
  }
  const isValid = Object.values(fields).every((f) => f.error === null);
  return { fields, isValid };
}

export function serializeArgs(state: AbiFormState): Record<string, FormFieldValue> {
  const args: Record<string, FormFieldValue> = {};
  for (const [name, field] of Object.entries(state.fields)) {
    args[name] = field.value;
  }
  return args;
}

/** 
 * Encode a value to XDR ScVal format (simulated).
 * In production, this would use @stellar/stellar-sdk's xdr module.
 */
export function encodeToScVal(value: FormFieldValue, param: AbiParam): unknown {
  if (value === "" || value === null || value === undefined) {
    if (param.optional) return { tag: "ScValNone", values: [] };
    throw new Error(`Missing required parameter: ${param.name}`);
  }

  const type = param.type;

  switch (type) {
    case "u32":
      return { tag: "U32", values: [Number(value)] };
    case "i32":
      return { tag: "I32", values: [Number(value)] };
    case "u64":
    case "u128":
    case "u256":
      return { tag: "U128", values: [{ value: String(value) }] };
    case "i64":
    case "i128":
    case "i256":
      return { tag: "I128", values: [{ value: String(value) }] };
    case "bool":
      return { tag: "Bool", values: [Boolean(value)] };
    case "address":
      return { tag: "Address", values: [{ value: String(value) }] };
    case "string":
      return { tag: "String", values: [String(value)] };
    case "bytes":
    case "bytesN":
      return { tag: "Bytes", values: [String(value)] };
    case "void":
      return { tag: "Void", values: [] };
    default:
      // For complex types like vec, map, tuple
      if (param.specType) {
        return encodeComplexType(value, param.specType);
      }
      return { tag: "String", values: [String(value)] };
  }
}

function encodeComplexType(value: unknown, spec: ScSpecTypeDef): unknown {
  if (typeof spec === "string") {
    return { tag: "String", values: [String(value)] };
  }

  switch (spec.type) {
    case "vec": {
      const arr = Array.isArray(value) ? value : [];
      return {
        tag: "Vec",
        values: arr.map(v => encodeToScVal(v, { name: "", type: spec.elementType as SorobanScType })),
      };
    }
    case "map": {
      const obj = typeof value === "object" && value !== null ? value : {};
      return {
        tag: "Map",
        values: Object.entries(obj).map(([k, v]) => ({
          key: { tag: "String", values: [k] },
          val: encodeToScVal(v, { name: "", type: spec.valueType as SorobanScType }),
        })),
      };
    }
    case "tuple": {
      const arr = Array.isArray(value) ? value : [];
      return {
        tag: "Tuple",
        values: spec.elements.map((el, i) => 
          encodeToScVal(arr[i], { name: "", type: el as SorobanScType })
        ),
      };
    }
    default:
      return { tag: "String", values: [String(value)] };
  }
}

/** Encode all form arguments to XDR ScVal bytes */
export function encodeArgsToXdr(
  state: AbiFormState
): Array<{ name: string; value: unknown }> {
  return Object.entries(state.fields).map(([name, field]) => ({
    name,
    value: encodeToScVal(field.value, field.param),
  }));
}

/**
 * Fetch ABI JSON from the Soroban contract registry
 * @param contractId - The contract ID to fetch ABI for
 * @param network - 'testnet' or 'mainnet'
 */
export async function fetchAbiFromRegistry(
  contractId: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<ContractAbi> {
  const registryUrl = network === "testnet"
    ? "https://soroban-testnet.sorotask.io/registry"
    : "https://soroban.sorotask.io/registry";
  
  const response = await fetch(`${registryUrl}/abi/${contractId}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ABI: ${response.statusText}`);
  }
  
  return response.json();
}
