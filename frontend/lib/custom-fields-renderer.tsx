import type { ChangeEvent } from 'react';
import {
  type CustomFieldDefinition,
  type CustomFieldValues,
  formatFieldValue,
  getDefinitionMap,
} from '@/lib/custom-fields';

interface EditableProps {
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues;
  errors?: Record<string, string>;
  disabled?: boolean;
  onValueChange: (key: string, value: string | number | boolean) => void;
}

export function CustomFieldsEditableRenderer({
  definitions,
  values,
  errors,
  disabled,
  onValueChange,
}: EditableProps) {
  const activeDefinitions = definitions.filter((field) => !field.retired);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-neutral-100">Custom Fields</h3>
      {activeDefinitions.length === 0 && (
        <p className="text-sm text-neutral-500">No active custom fields are configured.</p>
      )}

      {activeDefinitions.map((field) => {
        const rawValue = values[field.key];
        const valueString = typeof rawValue === 'string' ? rawValue : '';
        const valueNumber = typeof rawValue === 'number' ? rawValue : '';
        const valueBoolean = rawValue === true;

        return (
          <div key={field.id}>
            <label htmlFor={field.key} className="block text-sm font-medium text-neutral-400 mb-1">
              {field.label}
              {field.required ? <span className="text-red-400"> *</span> : null}
            </label>

            {field.type === 'text' && (
              <input
                id={field.key}
                type="text"
                value={valueString}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(field.key, event.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm disabled:opacity-50"
              />
            )}

            {field.type === 'select' && (
              <select
                id={field.key}
                value={valueString}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => onValueChange(field.key, event.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm disabled:opacity-50"
              >
                <option value="">Select one</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}

            {field.type === 'number' && (
              <input
                id={field.key}
                type="number"
                value={valueNumber}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  onValueChange(field.key, event.target.value === '' ? '' : Number(event.target.value));
                }}
                className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm disabled:opacity-50"
              />
            )}

            {field.type === 'checkbox' && (
              <label className="inline-flex items-center gap-2 text-sm text-neutral-300" htmlFor={field.key}>
                <input
                  id={field.key}
                  type="checkbox"
                  checked={valueBoolean}
                  disabled={disabled}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(field.key, event.target.checked)}
                  className="w-4 h-4 accent-blue-500"
                />
                Enabled
              </label>
            )}

            {field.type === 'date' && (
              <input
                id={field.key}
                type="date"
                value={valueString}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(field.key, event.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm disabled:opacity-50"
              />
            )}

            {errors?.[field.key] && <p className="text-xs text-red-400 mt-1">{errors[field.key]}</p>}
          </div>
        );
      })}
    </div>
  );
}

interface ReadOnlyProps {
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues;
  title?: string;
}

export function CustomFieldsReadOnlyRenderer({ definitions, values, title = 'Custom Field Values' }: ReadOnlyProps) {
  const definitionMap = getDefinitionMap(definitions);
  const keys = Object.keys(values);

  if (keys.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-neutral-100">{title}</h3>
        <p className="text-sm text-neutral-500">No custom values were captured.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-neutral-100">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {keys.map((key) => {
          const definition = definitionMap.get(key);
          const label = definition ? definition.label : `Retired field: ${key}`;
          const value = formatFieldValue(definition, values[key]);

          return (
            <div key={key} className="bg-neutral-900/60 border border-neutral-700/50 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-neutral-400">{label}</p>
                {definition?.retired ? (
                  <span className="text-[10px] uppercase tracking-wide text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                    Retired
                  </span>
                ) : null}
                {!definition ? (
                  <span className="text-[10px] uppercase tracking-wide text-neutral-300 bg-neutral-700/50 border border-neutral-600 rounded px-1.5 py-0.5">
                    Missing Schema
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-neutral-200 mt-1 break-words">{value}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
