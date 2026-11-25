import { z } from 'zod';
import { ValidationRule } from './types';

/**
 * Creates a ValidationRule that validates a single field using a Zod object schema.
 */
export function createZodFieldValidator<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  fieldName: keyof T & string
): ValidationRule {
  const fieldSchema = schema.shape[fieldName] as unknown as z.ZodTypeAny;

  return {
    validate: (value: unknown) => {
      const result = fieldSchema.safeParse(value);

      if (result.success) {
        return { isValid: true };
      }

      const message =
        result.error.issues[0]?.message ?? 'Invalid value';

      return { isValid: false, message };
    },
  };
}

/**
 * Validates all fields in a Zod object schema and returns per-field error messages.
 */
export function validateFormWithZod<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  values: Record<string, unknown>
): Record<string, string[]> {
  const result = schema.safeParse(values);
  const errors: Record<string, string[]> = {};

  if (result.success) {
    return errors;
  }

  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string') continue;

    if (!errors[field]) {
      errors[field] = [];
    }

    if (!errors[field].includes(issue.message)) {
      errors[field].push(issue.message);
    }
  }

  return errors;
}

/**
 * Validates a single field value against a Zod object schema.
 */
export function validateFieldWithZod<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  fieldName: keyof T & string,
  value: unknown
): string[] {
  const fieldSchema = schema.shape[fieldName] as unknown as z.ZodTypeAny;
  const result = fieldSchema.safeParse(value);

  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => issue.message);
}
