"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildInitialFormState,
  updateField,
  validateAll,
  serializeArgs,
  encodeArgsToXdr,
  fetchAbiFromRegistry,
  type AbiFunction,
  type FormFieldValue,
  type ScSpecVectorType,
  type ScSpecMapType,
  type SorobanScType,
} from "@/lib/abi-form";

interface AbiDynamicFormProps {
  /** Initial function to render (or null to show function selector) */
  fn?: AbiFunction | null;
  /** Callback when form is submitted */
  onSubmit: (fnName: string, args: Record<string, FormFieldValue>, xdrArgs: Array<{ name: string; value: unknown }>) => void;
  isSubmitting?: boolean;
  /** Contract ID to fetch ABI from */
  contractId?: string;
  /** Network for ABI fetching */
  network?: "testnet" | "mainnet";
}

interface VecInputProps {
  param: { name: string; type: SorobanScType; optional?: boolean };
  value: unknown[];
  onChange: (value: unknown[]) => void;
  error: string | null;
}

interface MapInputProps {
  param: { name: string; type: SorobanScType; optional?: boolean };
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  error: string | null;
}

/** Render dynamic input for Vec type */
function VecInput({ param, value = [], onChange, error }: VecInputProps) {
  const addItem = () => onChange([...value, ""]);
  const updateItem = (index: number, itemValue: unknown) => {
    const updated = [...value];
    updated[index] = itemValue;
    onChange(updated);
  };
  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {value.map((item, index) => (
        <div key={index} className="flex gap-2 items-start">
          <input
            type="text"
            value={item as string}
            onChange={(e) => updateItem(index, e.target.value)}
            placeholder={`Element ${index + 1}`}
            className="flex-1 bg-neutral-800 border rounded px-3 py-2 text-sm text-neutral-100 border-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => removeItem(index)}
            className="px-2 py-1 text-neutral-500 hover:text-red-400 text-sm"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="text-xs text-blue-400 hover:text-blue-300"
      >
        + Add {param.type} element
      </button>
    </div>
  );
}

/** Render dynamic input for Map type */
function MapInput({ param, value = {}, onChange, error }: MapInputProps) {
  const [newKey, setNewKey] = useState("");
  
  const addEntry = () => {
    if (newKey && !value[newKey]) {
      onChange({ ...value, [newKey]: "" });
      setNewKey("");
    }
  };
  const updateValue = (key: string, val: unknown) => {
    onChange({ ...value, [key]: val });
  };
  const removeEntry = (key: string) => {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  };

  return (
    <div className="space-y-2">
      {Object.entries(value).map(([key, val]) => (
        <div key={key} className="flex gap-2 items-start">
          <div className="w-24 text-xs text-neutral-500 pt-2 font-mono">{key}</div>
          <input
            type="text"
            value={val as string}
            onChange={(e) => updateValue(key, e.target.value)}
            className="flex-1 bg-neutral-800 border rounded px-3 py-2 text-sm text-neutral-100 border-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => removeEntry(key)}
            className="px-2 py-1 text-neutral-500 hover:text-red-400 text-sm"
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="Key"
          className="w-24 bg-neutral-800 border rounded px-3 py-2 text-sm text-neutral-100 border-neutral-700"
        />
        <button
          type="button"
          onClick={addEntry}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + Add entry
        </button>
      </div>
    </div>
  );
}

export function AbiDynamicForm({ 
  fn: initialFn, 
  onSubmit, 
  isSubmitting = false,
  contractId,
  network = "testnet",
}: AbiDynamicFormProps) {
  // Function selector state (Easy: Input field for function name)
  const [functionName, setFunctionName] = useState("");
  const [selectedFn, setSelectedFn] = useState<AbiFunction | null>(initialFn || null);
  const [abiFunctions, setAbiFunctions] = useState<AbiFunction[]>([]);
  const [loadingAbi, setLoadingAbi] = useState(false);
  const [abiError, setAbiError] = useState<string | null>(null);

  // Fetch ABI when contractId changes (Medium: Fetch ABI JSON from registry)
  useEffect(() => {
    if (!contractId) return;
    
    const loadAbi = async () => {
      setLoadingAbi(true);
      setAbiError(null);
      try {
        const abi = await fetchAbiFromRegistry(contractId, network);
        setAbiFunctions(abi.functions);
      } catch (err) {
        setAbiError(err instanceof Error ? err.message : "Failed to fetch ABI");
      } finally {
        setLoadingAbi(false);
      }
    };
    
    loadAbi();
  }, [contractId, network]);

  // Build form state when function is selected
  const initial = useMemo(() => 
    selectedFn ? buildInitialFormState(selectedFn) : null, 
    [selectedFn]
  );
  const [formState, setFormState] = useState(initial);

  // Update form when function changes
  useEffect(() => {
    if (initialFn) {
      setSelectedFn(initialFn);
      setFunctionName(initialFn.name);
    }
  }, [initialFn]);

  // Handle function name change - try to find matching ABI function
  const handleFunctionNameChange = useCallback((name: string) => {
    setFunctionName(name);
    const matched = abiFunctions.find(f => f.name === name);
    if (matched) {
      setSelectedFn(matched);
      setFormState(buildInitialFormState(matched));
    }
  }, [abiFunctions]);

  const handleChange = useCallback(
    (name: string, value: FormFieldValue) => {
      if (!formState) return;
      setFormState((prev) => prev ? updateField(prev, name, value) : prev);
    },
    [formState],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!formState || !selectedFn) return;
      const validated = validateAll(formState);
      setFormState(validated);
      if (!validated.isValid) return;
      // Advanced: encode to XDR ScVal bytes
      const xdrArgs = encodeArgsToXdr(validated);
      onSubmit(selectedFn.name, serializeArgs(validated), xdrArgs);
    },
    [formState, selectedFn, onSubmit],
  );

  // Render dynamic input based on parameter type (Advanced: Dynamic form inputs)
  const renderInput = (param: { name: string; type: SorobanScType; specType?: unknown; optional?: boolean }, field: { value: FormFieldValue; error: string | null }, onChange: (value: FormFieldValue) => void) => {
  const fieldId = `abi-${selectedFn?.name || 'form'}-${param.name}`;
  const specType = param.specType as ScSpecVectorType | ScSpecMapType | undefined;

  // Handle Vec type
  if (specType?.type === "vec") {
    return (
      <VecInput
        param={param}
        value={field.value as unknown[]}
        onChange={onChange}
        error={field.error}
      />
    );
  }

  // Handle Map type
  if (specType?.type === "map") {
    return (
      <MapInput
        param={param}
        value={field.value as Record<string, unknown>}
        onChange={onChange}
        error={field.error}
      />
    );
  }

  // Handle bool type
  if (param.type === "bool") {
    return (
      <input
        id={fieldId}
        type="checkbox"
        checked={field.value as boolean}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-blue-500"
        aria-describedby={field.error ? `${fieldId}-error` : undefined}
      />
    );
  }

  // Handle numeric types with appropriate inputMode
  const isUnsigned = ["u32", "u64", "u128", "u256"].includes(param.type);
  const isInteger = ["u32", "i32", "u64", "i64", "u128", "i128", "u256", "i256"].includes(param.type);

  return (
    <input
      id={fieldId}
      type="text"
      inputMode={isUnsigned ? "numeric" : isInteger ? "text" : "text"}
      value={field.value as string}
      onChange={(e) => onChange(e.target.value)}
      placeholder={param.type === "address" ? "G... or C..." : param.type}
      aria-required={!param.optional}
      aria-invalid={!!field.error}
      aria-describedby={field.error ? `${fieldId}-error` : undefined}
      className={`bg-neutral-800 border rounded px-3 py-2 text-sm text-neutral-100 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 ${field.error ? "border-red-500" : "border-neutral-700"}`}
    />
  );
};

if (!selectedFn) {
  // Show function selector when no function is selected
  return (
    <div className="space-y-4">
      {/* Easy: Input field for function name */}
      <div className="flex flex-col gap-1">
        <label htmlFor="function-name" className="text-sm font-medium text-neutral-300">
          Function Name
        </label>
        <input
          id="function-name"
          type="text"
          value={functionName}
          onChange={(e) => handleFunctionNameChange(e.target.value)}
          placeholder="e.g., create_task, update_status"
          list="function-list"
          className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <datalist id="function-list">
          {abiFunctions.map(f => (
            <option key={f.name} value={f.name} />
          ))}
        </datalist>
      </div>

      {/* Loading indicator for ABI fetch */}
      {loadingAbi && (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <div className="h-4 w-4 animate-spin rounded-full border border-blue-500 border-t-transparent" />
          Fetching ABI from registry...
        </div>
      )}

      {/* ABI fetch error */}
      {abiError && (
        <p className="text-xs text-red-400">{abiError}</p>
      )}

      {/* Function dropdown if ABI loaded */}
      {abiFunctions.length > 0 && (
        <select
          value={functionName}
          onChange={(e) => handleFunctionNameChange(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 w-full"
        >
          <option value="">Select a function...</option>
          {abiFunctions.map(f => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

const fn = selectedFn;

return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label={`${fn.name} form`}>
      {fn.doc && <p className="text-sm text-neutral-400">{fn.doc}</p>}

    {fn.inputs.length === 0 && (
      <p className="text-sm text-neutral-500 italic">No inputs required.</p>
    )}

    {formState && fn.inputs.map((param) => {
      const field = formState.fields[param.name];
      if (!field) return null;

      return (
        <div key={param.name} className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-300">
            {param.name}
            {!param.optional && <span className="text-red-400 ml-1" aria-hidden="true">*</span>}
            <span className="ml-2 text-xs text-neutral-500 font-mono">
              {param.specType ? JSON.stringify(param.specType) : param.type}
            </span>
          </label>

          {renderInput(param, field, (value) => handleChange(param.name, value))}

          {field.error && (
            <p role="alert" className="text-xs text-red-400">
              {field.error}
            </p>
          )}
        </div>
      );
    })}

    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => {
          setSelectedFn(null);
          setFormState(null);
        }}
        className="mt-2 px-4 py-2 border border-neutral-700 text-neutral-300 text-sm font-medium rounded hover:bg-neutral-800 transition-colors"
      >
        Change Function
      </button>
      <button
        type="submit"
        disabled={isSubmitting || !formState?.isValid}
        className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? "Executing…" : `Call ${fn.name}`}
      </button>
    </div>
  </form>
  );
}
