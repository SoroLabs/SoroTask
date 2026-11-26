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
  | "symbol"
  | "string"
  | "bytes"
  | "bytesN"
  | "address"
  | "noncekey"
  | "struct"
  | "vec"
  | "array"
  | "map"
  | "option"
  | "tuple"
  | "void";

/** Complex types from ScSpec - arrays, tuples, maps, vectors, structs */
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

export interface ScSpecStructField {
  name: string;
  type: SorobanScType | ScSpecTypeDef;
  optional?: boolean;
  doc?: string;
}

export interface ScSpecStructType {
  type: "struct";
  name?: string;
  fields: ScSpecStructField[];
}

export type ScSpecTypeDef =
  | SorobanScType
  | ScSpecVectorType
  | ScSpecMapType
  | ScSpecArrayType
  | ScSpecOptionType
  | ScSpecTupleType
  | ScSpecStructType;

export interface AbiParam {
  name: string;
  type: SorobanScType;
  specType?: ScSpecTypeDef;
  optional?: boolean;
  doc?: string;
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

export type FormFieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | unknown[]
  | Record<string, unknown>;

export interface AbiFormField {
  param: AbiParam;
  value: FormFieldValue;
  error: string | null;
}

export interface AbiFormState {
  fields: Record<string, AbiFormField>;
  isValid: boolean;
}

export type AbiInputControlType =
  | "text"
  | "number"
  | "checkbox"
  | "struct"
  | "array"
  | "json";

export interface AbiFieldDescriptor {
  name: string;
  label: string;
  inputType: AbiInputControlType;
  sorobanType: SorobanScType;
  required: boolean;
  placeholder: string;
  doc?: string;
  zodSchema: z.ZodType<unknown>;
  fields?: AbiFieldDescriptor[];
  itemSchema?: z.ZodType<unknown>;
  fixedLength?: number;
}

const MAX_U64 = (1n << 64n) - 1n;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const MAX_U128 = (1n << 128n) - 1n;
const MIN_I128 = -(1n << 127n);
const MAX_I128 = (1n << 127n) - 1n;
const MAX_U256 = (1n << 256n) - 1n;
const MIN_I256 = -(1n << 255n);
const MAX_I256 = (1n << 255n) - 1n;

function createBigIntSchema(
  minVal: bigint,
  maxVal: bigint,
  label: string,
): z.ZodType<unknown> {
  return z.union([z.string(), z.number(), z.bigint()]).superRefine((val, ctx) => {
    const str = typeof val === "bigint" ? val.toString() : String(val).trim();
    if (!/^-?\d+$/.test(str)) {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be a valid integer`,
      });
      return;
    }
    try {
      const parsed = BigInt(str);
      if (parsed < minVal) {
        ctx.addIssue({
          code: "custom",
          message:
            minVal === 0n
              ? `${label} must be a non-negative integer`
              : `${label} is below minimum value`,
        });
      } else if (parsed > maxVal) {
        ctx.addIssue({
          code: "custom",
          message: `${label} exceeds maximum value`,
        });
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be a valid integer`,
      });
    }
  });
}

function createSafeIntSchema(
  minVal: number,
  maxVal: number,
  label: string,
): z.ZodType<unknown> {
  return z.union([z.string(), z.number()]).superRefine((val, ctx) => {
    const str = String(val).trim();
    if (!/^-?\d+$/.test(str)) {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be an integer`,
      });
      return;
    }
    const num = Number(str);
    if (!Number.isInteger(num) || num < minVal || num > maxVal) {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be between ${minVal} and ${maxVal}`,
      });
    }
  });
}

/** Zod schemas for each Soroban primitive type */
const schemas: Record<SorobanScType, z.ZodType<unknown>> = {
  u32: createSafeIntSchema(0, 4294967295, "u32"),
  i32: createSafeIntSchema(-2147483648, 2147483647, "i32"),
  u64: createBigIntSchema(0n, MAX_U64, "u64"),
  i64: createBigIntSchema(MIN_I64, MAX_I64, "i64"),
  u128: createBigIntSchema(0n, MAX_U128, "u128"),
  i128: createBigIntSchema(MIN_I128, MAX_I128, "i128"),
  u256: createBigIntSchema(0n, MAX_U256, "u256"),
  i256: createBigIntSchema(MIN_I256, MAX_I256, "i256"),
  bool: z.boolean(),
  symbol: z
    .string()
    .min(1, "Symbol is required")
    .max(32, "Symbol must be at most 32 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Symbol must contain only letters, numbers, and underscores",
    ),
  string: z.string(),
  bytes: z.string().regex(/^[0-9a-fA-F]*$/, "Must be a valid hex string"),
  bytesN: z.string().regex(/^[0-9a-fA-F]+$/, "Must be a non-empty hex string"),
  address: z
    .string()
    .regex(/^[GC][A-Z2-7]{55}$/, "Invalid Stellar address (must start with G or C)"),
  noncekey: z
    .string()
    .regex(/^[GC][A-Z2-7]{55}$/, "Invalid Stellar address (must start with G or C)"),
  struct: z.record(z.string(), z.unknown()),
  vec: z.array(z.unknown()),
  array: z.array(z.unknown()),
  map: z.record(z.string(), z.unknown()),
  option: z.unknown().nullable().optional(),
  tuple: z.array(z.unknown()),
  void: z.any(),
};

/** Extract first error message from a ZodError (supports Zod v3 & v4) */
export function extractZodErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issues = error.issues ?? (error as unknown as { errors?: Array<{ message: string }> }).errors;
    if (Array.isArray(issues) && issues.length > 0) {
      const first = issues[0];
      const pathPrefix =
        "path" in first && Array.isArray(first.path) && first.path.length > 0
          ? `${first.path.join(".")}: `
          : "";
      return `${pathPrefix}${first.message}`;
    }
  }
  return "Invalid value";
}

/** Get Zod schema for a parameter */
export function getZodSchema(param: AbiParam): z.ZodType<unknown> {
  const base = param.specType
    ? getSpecTypeSchema(param.specType)
    : schemas[param.type] || z.string();

  return param.optional ? base.optional().nullable() : base;
}

export function getSpecTypeSchema(spec: ScSpecTypeDef): z.ZodType<unknown> {
  if (typeof spec === "string") {
    return schemas[spec] || z.string();
  }

  switch (spec.type) {
    case "vec":
      return z.array(getSpecTypeSchema(spec.elementType));
    case "map":
      return z.record(z.string(), getSpecTypeSchema(spec.valueType));
    case "array":
      return z
        .array(getSpecTypeSchema(spec.elementType))
        .length(spec.size, `Must contain exactly ${spec.size} items`);
    case "option":
      return z.union([getSpecTypeSchema(spec.innerType), z.null(), z.undefined()]);
    case "tuple": {
      if (spec.elements.length === 0) {
        return z.array(z.never()).length(0);
      }
      const elementSchemas = spec.elements.map((e) => getSpecTypeSchema(e)) as [
        z.ZodType<unknown>,
        ...z.ZodType<unknown>[],
      ];
      return z.tuple(elementSchemas);
    }
    case "struct": {
      const shape: Record<string, z.ZodType<unknown>> = {};
      for (const field of spec.fields) {
        const fieldSchema = getSpecTypeSchema(field.type);
        shape[field.name] = field.optional ? fieldSchema.optional() : fieldSchema;
      }
      return z.object(shape);
    }
    default:
      return z.string();
  }
}

/** Build a complete Zod object schema for an entire AbiFunction's inputs */
export function getFunctionZodSchema(fn: AbiFunction): z.ZodObject<Record<string, z.ZodType<unknown>>> {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const param of fn.inputs) {
    shape[param.name] = getZodSchema(param);
  }
  return z.object(shape);
}

function isComplexParam(param: AbiParam): boolean {
  if (param.specType && typeof param.specType !== "string") {
    return true;
  }
  return (
    param.type === "struct" ||
    param.type === "vec" ||
    param.type === "array" ||
    param.type === "map" ||
    param.type === "tuple"
  );
}

export function validateValueWithZod(
  value: FormFieldValue,
  param: AbiParam,
): string | null {
  if (param.optional && (value === "" || value === null || value === undefined)) {
    return null;
  }

  if (param.specType && typeof param.specType !== "string" && param.specType.type === "option") {
    if (value === "" || value === null || value === undefined) {
      return null;
    }
  }

  if (param.type === "bool" && !param.specType) {
    if (typeof value !== "boolean") {
      return `${param.name} must be a boolean`;
    }
    return null;
  }

  let valueToValidate: unknown = value;

  if (isComplexParam(param)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return `${param.name} is required`;
      try {
        valueToValidate = JSON.parse(trimmed);
      } catch {
        return `${param.name} must be valid JSON`;
      }
    } else if (value === null || value === undefined) {
      return `${param.name} is required`;
    }
  } else {
    const str = value === null || value === undefined ? "" : String(value).trim();
    if (!str) return `${param.name} is required`;
    valueToValidate = typeof value === "string" ? str : value;
  }

  const schema = getZodSchema(param);
  const result = schema.safeParse(valueToValidate);
  if (!result.success) {
    return extractZodErrorMessage(result.error);
  }
  return null;
}

/** Legacy validation alias for backwards compatibility */
function validateValue(value: FormFieldValue, param: AbiParam): string | null {
  return validateValueWithZod(value, param);
}

function getDefaultValueForSpec(spec: ScSpecTypeDef): FormFieldValue {
  if (typeof spec === "string") {
    return spec === "bool" ? false : "";
  }
  switch (spec.type) {
    case "vec":
    case "tuple":
      return [];
    case "array":
      return Array.from({ length: spec.size }, () =>
        getDefaultValueForSpec(spec.elementType),
      );
    case "struct": {
      const obj: Record<string, unknown> = {};
      for (const field of spec.fields) {
        obj[field.name] = getDefaultValueForSpec(field.type);
      }
      return obj;
    }
    case "map":
      return {};
    case "option":
      return null;
    default:
      return "";
  }
}

export function buildInitialFormState(fn: AbiFunction): AbiFormState {
  const fields: Record<string, AbiFormField> = {};
  for (const param of fn.inputs) {
    const initialValue = param.specType
      ? getDefaultValueForSpec(param.specType)
      : param.type === "bool"
        ? false
        : param.type === "vec" || param.type === "array" || param.type === "tuple"
          ? []
          : param.type === "struct" || param.type === "map"
            ? {}
            : "";

    fields[param.name] = {
      param,
      value: initialValue,
      error: null,
    };
  }
  return {
    fields,
    isValid: fn.inputs.every((p) => p.optional || p.type === "bool"),
  };
}

function formatParamLabel(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getPlaceholderForParam(param: AbiParam): string {
  if (param.specType && typeof param.specType !== "string") {
    switch (param.specType.type) {
      case "vec":
      case "array":
        return "[]";
      case "struct":
      case "map":
        return "{}";
      case "tuple":
        return "[]";
      default:
        return "";
    }
  }
  switch (param.type) {
    case "address":
    case "noncekey":
      return "G... or C...";
    case "symbol":
      return "e.g. harvest_yield";
    case "u32":
    case "i32":
    case "u64":
    case "i64":
    case "u128":
    case "i128":
    case "u256":
    case "i256":
      return `Enter ${param.type} integer`;
    case "bytes":
    case "bytesN":
      return "Hex string (e.g. deadbeef)";
    default:
      return `Enter ${param.name}`;
  }
}

function getInputControlType(param: AbiParam): AbiInputControlType {
  if (param.specType && typeof param.specType !== "string") {
    switch (param.specType.type) {
      case "struct":
        return "struct";
      case "vec":
      case "array":
      case "tuple":
        return "array";
      case "map":
        return "json";
      case "option":
        return typeof param.specType.innerType === "string"
          ? getInputControlType({ name: param.name, type: param.specType.innerType })
          : "json";
    }
  }
  switch (param.type) {
    case "bool":
      return "checkbox";
    case "u32":
    case "i32":
      return "number";
    case "struct":
      return "struct";
    case "vec":
    case "array":
    case "tuple":
      return "array";
    case "map":
      return "json";
    default:
      return "text";
  }
}

/** Auto-generate structured UI field descriptors from an AbiFunction signature */
export function generateAbiFormDescriptors(fn: AbiFunction): AbiFieldDescriptor[] {
  return fn.inputs.map((param) => buildFieldDescriptor(param));
}

function buildFieldDescriptor(param: AbiParam): AbiFieldDescriptor {
  const descriptor: AbiFieldDescriptor = {
    name: param.name,
    label: formatParamLabel(param.name),
    inputType: getInputControlType(param),
    sorobanType: param.type,
    required: !param.optional,
    placeholder: getPlaceholderForParam(param),
    doc: param.doc,
    zodSchema: getZodSchema(param),
  };

  if (param.specType && typeof param.specType !== "string") {
    if (param.specType.type === "struct") {
      descriptor.fields = param.specType.fields.map((f) =>
        buildFieldDescriptor({
          name: f.name,
          type: typeof f.type === "string" ? f.type : f.type.type,
          specType: typeof f.type === "string" ? undefined : f.type,
          optional: f.optional,
          doc: f.doc,
        }),
      );
    } else if (param.specType.type === "vec") {
      descriptor.itemSchema = getSpecTypeSchema(param.specType.elementType);
    } else if (param.specType.type === "array") {
      descriptor.itemSchema = getSpecTypeSchema(param.specType.elementType);
      descriptor.fixedLength = param.specType.size;
    }
  }

  return descriptor;
}

function isFieldFilled(field: AbiFormField): boolean {
  if (field.param.optional) return true;
  if (field.param.type === "bool") return typeof field.value === "boolean";
  if (field.value === "" || field.value === null || field.value === undefined) {
    return false;
  }
  return true;
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
  const isValid = Object.values(updated).every(
    (f) => f.error === null && isFieldFilled(f),
  );

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

export function serializeArgs(
  state: AbiFormState,
): Record<string, FormFieldValue> {
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

  if (param.specType && typeof param.specType !== "string") {
    return encodeComplexType(value, param.specType);
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
    case "symbol":
      return { tag: "Symbol", values: [String(value)] };
    case "address":
    case "noncekey":
      return { tag: "Address", values: [{ value: String(value) }] };
    case "string":
      return { tag: "String", values: [String(value)] };
    case "bytes":
    case "bytesN":
      return { tag: "Bytes", values: [String(value)] };
    case "void":
      return { tag: "Void", values: [] };
    default:
      return { tag: "String", values: [String(value)] };
  }
}

function encodeComplexType(value: unknown, spec: ScSpecTypeDef): unknown {
  if (typeof spec === "string") {
    return encodeToScVal(value as FormFieldValue, { name: "", type: spec });
  }

  switch (spec.type) {
    case "vec":
    case "array": {
      const arr = Array.isArray(value) ? value : [];
      return {
        tag: "Vec",
        values: arr.map((v) =>
          encodeToScVal(v as FormFieldValue, {
            name: "",
            type:
              typeof spec.elementType === "string"
                ? spec.elementType
                : spec.elementType.type,
            specType:
              typeof spec.elementType === "string" ? undefined : spec.elementType,
          }),
        ),
      };
    }
    case "map": {
      const obj =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)
          : {};
      return {
        tag: "Map",
        values: Object.entries(obj).map(([k, v]) => ({
          key: { tag: "String", values: [k] },
          val: encodeToScVal(v as FormFieldValue, {
            name: "",
            type:
              typeof spec.valueType === "string"
                ? spec.valueType
                : spec.valueType.type,
            specType:
              typeof spec.valueType === "string" ? undefined : spec.valueType,
          }),
        })),
      };
    }
    case "struct": {
      const obj =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)
          : {};
      return {
        tag: "Map",
        values: spec.fields.map((field) => ({
          key: { tag: "Symbol", values: [field.name] },
          val: encodeToScVal(obj[field.name] as FormFieldValue, {
            name: field.name,
            type:
              typeof field.type === "string" ? field.type : field.type.type,
            specType:
              typeof field.type === "string" ? undefined : field.type,
            optional: field.optional,
          }),
        })),
      };
    }
    case "tuple": {
      const arr = Array.isArray(value) ? value : [];
      return {
        tag: "Tuple",
        values: spec.elements.map((el, i) =>
          encodeToScVal(arr[i] as FormFieldValue, {
            name: "",
            type: typeof el === "string" ? el : el.type,
            specType: typeof el === "string" ? undefined : el,
          }),
        ),
      };
    }
    case "option": {
      if (value === null || value === undefined || value === "") {
        return { tag: "ScValNone", values: [] };
      }
      return encodeComplexType(value, spec.innerType);
    }
    default:
      return { tag: "String", values: [String(value)] };
  }
}

/** Encode all form arguments to XDR ScVal bytes */
export function encodeArgsToXdr(
  state: AbiFormState,
): Array<{ name: string; value: unknown }> {
  return Object.entries(state.fields).map(([name, field]) => ({
    name,
    value: encodeToScVal(field.value, field.param),
  }));
}

const ContractAbiResponseSchema = z.object({
  contractId: z.string().min(1),
  functions: z.array(
    z.object({
      name: z.string().min(1),
      inputs: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          specType: z.unknown().optional(),
          optional: z.boolean().optional(),
          doc: z.string().optional(),
        }),
      ),
      outputs: z.array(z.unknown()).default([]),
      doc: z.string().optional(),
    }),
  ),
});

interface AbiCacheEntry {
  abi: ContractAbi;
  expiresAt: number;
}

const ABI_CACHE_TTL_MS = 5 * 60 * 1000;
const abiCache = new Map<string, AbiCacheEntry>();

export function clearAbiCache(): void {
  abiCache.clear();
}

export interface FetchAbiOptions {
  baseUrl?: string;
  signal?: AbortSignal;
  bypassCache?: boolean;
}

/**
 * Fetch ABI JSON from the Soroban contract backend-abi-registry with TTL caching
 * @param contractId - The contract ID to fetch ABI for
 * @param network - 'testnet' or 'mainnet'
 * @param options - Optional baseUrl, AbortSignal, or bypassCache
 */
export async function fetchAbiFromRegistry(
  contractId: string,
  network: "testnet" | "mainnet" = "testnet",
  options: FetchAbiOptions = {},
): Promise<ContractAbi> {
  const cacheKey = `${network}:${contractId}`;
  if (!options.bypassCache) {
    const cached = abiCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.abi;
    }
  }

  const registryUrl =
    options.baseUrl ??
    (network === "testnet"
      ? "https://soroban-testnet.sorotask.io/registry"
      : "https://soroban.sorotask.io/registry");

  const response = await fetch(`${registryUrl}/abi/${contractId}`, {
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ABI: ${response.statusText}`);
  }

  const raw = await response.json();
  const parsed = ContractAbiResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ABI payload: ${extractZodErrorMessage(parsed.error)}`);
  }

  const abi = raw as ContractAbi;
  abiCache.set(cacheKey, { abi, expiresAt: Date.now() + ABI_CACHE_TTL_MS });
  return abi;
}
