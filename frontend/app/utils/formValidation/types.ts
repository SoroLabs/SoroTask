export type ValidationRule<T = any> = {
  validate: (value: T) => ValidationResult;
  message?: string;
  required?: boolean;
  debounce?: number;
};

export type ValidationResult = {
  isValid: boolean;
  message?: string;
  warning?: string;
};

export type FieldValidation<T = any> = {
  value: T;
  errors: string[];
  warnings: string[];
  isValid: boolean;
  isDirty: boolean;
  isTouched: boolean;
  isValidating: boolean;
};

export type FormState<T extends Record<string, any> = Record<string, any>> = {
  values: T;
  errors: Record<keyof T, string[]>;
  warnings: Record<keyof T, string[]>;
  isValid: boolean;
  isDirty: boolean;
  isSubmitting: boolean;
  isSubmitted: boolean;
  touched: Record<keyof T, boolean>;
  validating: Record<keyof T, boolean>;
};

export type FormFieldConfig<T = any> = {
  name: string;
  initialValue?: T;
  validation?: ValidationRule<T>[];
  dependencies?: string[];
  asyncValidation?: (value: T) => Promise<ValidationResult>;
  debounceMs?: number;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  type?: 'text' | 'number' | 'email' | 'password' | 'textarea';
};

export type FormConfig<T extends Record<string, any> = Record<string, any>> = {
  fields: Record<keyof T, FormFieldConfig>;
  onSubmit?: (values: T) => Promise<void> | void;
  onFieldChange?: (field: keyof T, value: any, formState: FormState<T>) => void;
  onValidationChange?: (formState: FormState<T>) => void;
  validateOnChange?: boolean;
  validateOnBlur?: boolean;
  resetOnSubmit?: boolean;
  focusFirstError?: boolean;
};

export type AsyncValidationState = {
  isValidating: boolean;
  error?: string;
  lastValidated?: Date;
};

export type FormAction<T = any> =
  | { type: 'SET_VALUE'; field: string; value: T }
  | { type: 'SET_TOUCHED'; field: string; touched: boolean }
  | { type: 'SET_ERRORS'; field: string; errors: string[] }
  | { type: 'SET_WARNINGS'; field: string; warnings: string[] }
  | { type: 'SET_VALIDATING'; field: string; validating: boolean }
  | { type: 'SET_SUBMITTING'; submitting: boolean }
  | { type: 'SET_SUBMITTED'; submitted: boolean }
  | { type: 'RESET_FORM' }
  | { type: 'RESET_FIELD'; field: string }
  | { type: 'VALIDATE_FORM' }
  | { type: 'SET_FORM_VALUES'; values: Record<string, any> };
