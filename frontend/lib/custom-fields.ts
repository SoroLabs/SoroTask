export type CustomFieldType = 'text' | 'select' | 'number' | 'checkbox' | 'date';

export interface CustomFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  required?: boolean;
  options?: string[];
  retired?: boolean;
}

export type CustomFieldPrimitive = string | number | boolean | null;
export type CustomFieldValues = Record<string, CustomFieldPrimitive | undefined>;

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export function getDefinitionMap(definitions: CustomFieldDefinition[]): Map<string, CustomFieldDefinition> {
  return new Map(definitions.map((field) => [field.key, field]));
}

export function coerceForField(
  definition: CustomFieldDefinition | undefined,
  value: unknown,
): CustomFieldPrimitive | undefined {
  if (value === undefined) return undefined;

  if (!definition) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      return value;
    }
    return String(value);
  }

  switch (definition.type) {
    case 'text': {
      return value === null ? '' : String(value);
    }
    case 'select': {
      return value === null ? '' : String(value);
    }
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case 'checkbox': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return undefined;
    }
    case 'date': {
      if (value === null) return '';
      const asString = String(value);
      return /^\d{4}-\d{2}-\d{2}$/.test(asString) ? asString : undefined;
    }
    default:
      return undefined;
  }
}

export function sanitizeValues(
  definitions: CustomFieldDefinition[],
  values: Record<string, unknown>,
): CustomFieldValues {
  const definitionMap = getDefinitionMap(definitions);
  const sanitized: CustomFieldValues = {};

  for (const [key, raw] of Object.entries(values)) {
    sanitized[key] = coerceForField(definitionMap.get(key), raw);
  }

  return sanitized;
}

export function validateValues(
  definitions: CustomFieldDefinition[],
  values: CustomFieldValues,
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const definition of definitions) {
    if (definition.retired) continue;

    const value = values[definition.key];
    const hasValue = value !== undefined && value !== null && value !== '';

    if (definition.required && !hasValue) {
      errors[definition.key] = `${definition.label} is required.`;
      continue;
    }

    if (!hasValue) continue;

    if (definition.type === 'number' && typeof value !== 'number') {
      errors[definition.key] = `${definition.label} must be a valid number.`;
      continue;
    }

    if (definition.type === 'checkbox' && typeof value !== 'boolean') {
      errors[definition.key] = `${definition.label} must be true or false.`;
      continue;
    }

    if (definition.type === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      errors[definition.key] = `${definition.label} must be a valid date (YYYY-MM-DD).`;
      continue;
    }

    if (definition.type === 'select') {
      if (typeof value !== 'string' || !definition.options || !definition.options.includes(value)) {
        errors[definition.key] = `${definition.label} has an invalid selection.`;
      }
    }
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

export function formatFieldValue(
  definition: CustomFieldDefinition | undefined,
  rawValue: CustomFieldPrimitive | undefined,
): string {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return 'Not set';
  }

  if (!definition) {
    return `${String(rawValue)} (field definition removed)`;
  }

  switch (definition.type) {
    case 'checkbox':
      return rawValue === true ? 'Yes' : rawValue === false ? 'No' : 'Invalid boolean value';
    case 'number':
      return typeof rawValue === 'number' ? rawValue.toLocaleString() : 'Invalid number value';
    case 'date':
      return typeof rawValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
        ? rawValue
        : 'Invalid date value';
    case 'select':
      if (typeof rawValue !== 'string') return 'Invalid selection';
      if (definition.options && !definition.options.includes(rawValue)) return `${rawValue} (option retired)`;
      return rawValue;
    case 'text':
      return typeof rawValue === 'string' ? rawValue : String(rawValue);
    default:
      return String(rawValue);
  }
}

export function initialValuesFromDefinitions(definitions: CustomFieldDefinition[]): CustomFieldValues {
  const result: CustomFieldValues = {};

  for (const field of definitions) {
    if (field.retired) continue;
    if (field.type === 'checkbox') {
      result[field.key] = false;
      continue;
    }
    result[field.key] = '';
  }

  return result;
}
