'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FormState,
  FormConfig,
  FormFieldConfig,
  FormAction,
  FieldValidation,
  FieldA11yProps,
  AsyncValidationState
} from './types';
import { validateField as runFieldValidation } from './validators';
import {
  type AbiFunction,
  buildInitialFormState,
  extractZodErrorMessage,
  generateAbiFormDescriptors,
  getFunctionZodSchema,
  validateValueWithZod
} from '../../../src/lib/abi-form';

function buildInitialState<T extends Record<string, any>>(
  config: FormConfig<T>
): FormState<T> {
  const values = {} as T;
  const errors = {} as Record<keyof T, string[]>;
  const warnings = {} as Record<keyof T, string[]>;
  const touched = {} as Record<keyof T, boolean>;
  const validating = {} as Record<keyof T, boolean>;

  Object.entries(config.fields).forEach(([key, fieldConfig]) => {
    values[key as keyof T] = fieldConfig.initialValue as T[keyof T];
    errors[key as keyof T] = [];
    warnings[key as keyof T] = [];
    touched[key as keyof T] = false;
    validating[key as keyof T] = false;
  });

  return {
    values,
    errors,
    warnings,
    isValid: true,
    isDirty: false,
    isSubmitting: false,
    isSubmitted: false,
    touched,
    validating
  };
}

/**
 * Generate a FormConfig directly from a Soroban contract AbiFunction.
 * Auto-generates fields, initial values, Zod schemas, and real-time validators
 * matching the contract function signature (including structs and arrays).
 */
export function createFormConfigFromAbi<
  T extends Record<string, any> = Record<string, any>
>(
  fn: AbiFunction,
  options: Omit<FormConfig<T>, 'fields' | 'zodSchema'> = {}
): FormConfig<T> {
  const initialAbiState = buildInitialFormState(fn);
  const descriptors = generateAbiFormDescriptors(fn);
  const fields = {} as Record<keyof T, FormFieldConfig>;

  for (const descriptor of descriptors) {
    const abiField = initialAbiState.fields[descriptor.name];
    const inputType: FormFieldConfig['type'] =
      descriptor.inputType === 'checkbox'
        ? 'checkbox'
        : descriptor.inputType === 'number'
          ? 'number'
          : descriptor.inputType === 'json' ||
              descriptor.inputType === 'struct' ||
              descriptor.inputType === 'array'
            ? 'textarea'
            : 'text';

    fields[descriptor.name as keyof T] = {
      name: descriptor.name,
      initialValue: abiField?.value,
      required: descriptor.required,
      placeholder: descriptor.placeholder,
      type: inputType,
      zodSchema: descriptor.zodSchema,
      validation: [
        {
          validate: (val: any) => {
            const error = validateValueWithZod(val, abiField.param);
            return {
              isValid: error === null,
              message: error ?? undefined
            };
          },
          required: descriptor.required
        }
      ]
    };
  }

  return {
    ...options,
    fields,
    zodSchema: getFunctionZodSchema(fn)
  };
}

const useFormValidation = <T extends Record<string, any>>(
  config: FormConfig<T>
) => {
  const configRef = useRef(config);
  configRef.current = config;

  const [formState, setFormState] = useState<FormState<T>>(() =>
    buildInitialState(config)
  );
  const valuesRef = useRef(formState.values);
  valuesRef.current = formState.values;
  const asyncValidationStates = useRef<Record<string, AsyncValidationState>>({});
  const validationSeqRef = useRef<Record<string, number>>({});
  const debounceTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Re-initialize form state when dynamic field keys change (e.g. new ABI function selected)
  const fieldKeysSignature = Object.keys(config.fields).sort().join('|');
  const prevFieldKeysRef = useRef(fieldKeysSignature);

  useEffect(() => {
    if (prevFieldKeysRef.current !== fieldKeysSignature) {
      prevFieldKeysRef.current = fieldKeysSignature;
      Object.values(debounceTimeouts.current).forEach((t) => clearTimeout(t));
      debounceTimeouts.current = {};
      asyncValidationStates.current = {};
      validationSeqRef.current = {};
      const nextState = buildInitialState(configRef.current);
      valuesRef.current = nextState.values;
      setFormState(nextState);
    }
  }, [fieldKeysSignature]);

  // Form state reducer
  const formReducer = useCallback(
    (state: FormState<T>, action: FormAction): FormState<T> => {
      switch (action.type) {
        case 'SET_VALUE': {
          const newValues = { ...state.values, [action.field]: action.value };
          return { ...state, values: newValues, isDirty: true };
        }

        case 'SET_TOUCHED': {
          const newTouched = { ...state.touched, [action.field]: action.touched };
          return { ...state, touched: newTouched };
        }

        case 'SET_ERRORS': {
          const newErrors = { ...state.errors, [action.field]: action.errors };
          const isValid = Object.values(newErrors).every(
            (fieldErrors) => !fieldErrors || fieldErrors.length === 0
          );
          return { ...state, errors: newErrors, isValid };
        }

        case 'SET_WARNINGS': {
          const newWarnings = { ...state.warnings, [action.field]: action.warnings };
          return { ...state, warnings: newWarnings };
        }

        case 'SET_VALIDATING': {
          const newValidating = {
            ...state.validating,
            [action.field]: action.validating
          };
          return { ...state, validating: newValidating };
        }

        case 'SET_SUBMITTING':
          return { ...state, isSubmitting: action.submitting };

        case 'SET_SUBMITTED':
          return { ...state, isSubmitted: action.submitted };

        case 'RESET_FORM':
          return buildInitialState(configRef.current);

        case 'RESET_FIELD': {
          const fieldConfig = configRef.current.fields[action.field];
          const newValues = {
            ...state.values,
            [action.field]: fieldConfig?.initialValue
          };
          const newErrors = { ...state.errors, [action.field]: [] };
          const newWarnings = { ...state.warnings, [action.field]: [] };
          const newTouched = { ...state.touched, [action.field]: false };
          const newValidating = { ...state.validating, [action.field]: false };
          const isValid = Object.values(newErrors).every(
            (fieldErrors) => !fieldErrors || fieldErrors.length === 0
          );

          return {
            ...state,
            values: newValues,
            errors: newErrors,
            warnings: newWarnings,
            touched: newTouched,
            validating: newValidating,
            isValid
          };
        }

        case 'SET_FORM_VALUES':
          return { ...state, values: action.values as T };

        case 'VALIDATE_FORM':
          return state;

        default:
          return state;
      }
    },
    []
  );

  const dispatch = useCallback(
    (action: FormAction) => {
      setFormState((prevState) => formReducer(prevState, action));
    },
    [formReducer]
  );

  // Notify onValidationChange whenever errors or isValid update
  useEffect(() => {
    configRef.current.onValidationChange?.(formState);
  }, [formState.errors, formState.isValid]);

  // Run both rule-based and Zod schema validation for a single field
  const executeFieldValidators = useCallback(
    async (
      fieldName: string,
      value: any
    ): Promise<{ errors: string[]; warnings: string[] }> => {
      const fieldConfig = configRef.current.fields[fieldName];
      if (!fieldConfig) return { errors: [], warnings: [] };

      const errors: string[] = [];
      const warnings: string[] = [];

      if (fieldConfig.validation && fieldConfig.validation.length > 0) {
        const ruleResult = await runFieldValidation(value, fieldConfig.validation);
        errors.push(...ruleResult.errors);
        warnings.push(...ruleResult.warnings);
      } else if (fieldConfig.zodSchema) {
        const parsed = fieldConfig.zodSchema.safeParse(value);
        if (!parsed.success) {
          errors.push(extractZodErrorMessage(parsed.error));
        }
      }

      return { errors, warnings };
    },
    []
  );

  // Validate a single field
  const validateFieldByName = useCallback(
    async (
      fieldName: string,
      value: any,
      options: { immediate?: boolean } = {}
    ) => {
      const fieldConfig = configRef.current.fields[fieldName];
      if (!fieldConfig?.validation && !fieldConfig?.zodSchema) return;

      if (debounceTimeouts.current[fieldName]) {
        clearTimeout(debounceTimeouts.current[fieldName]);
      }

      const debounceMs = options.immediate ? 0 : (fieldConfig.debounceMs ?? 300);

      const performValidation = async () => {
        const seq = (validationSeqRef.current[fieldName] ?? 0) + 1;
        validationSeqRef.current[fieldName] = seq;

        dispatch({ type: 'SET_VALIDATING', field: fieldName, validating: true });

        try {
          const { errors, warnings } = await executeFieldValidators(
            fieldName,
            value
          );

          // Drop stale result if a newer validation started
          if (validationSeqRef.current[fieldName] !== seq) return;

          dispatch({ type: 'SET_ERRORS', field: fieldName, errors });
          dispatch({ type: 'SET_WARNINGS', field: fieldName, warnings });
        } catch (error) {
          if (validationSeqRef.current[fieldName] !== seq) return;
          console.error(`Validation error for field ${fieldName}:`, error);
          dispatch({
            type: 'SET_ERRORS',
            field: fieldName,
            errors: ['Validation failed. Please try again.']
          });
        } finally {
          if (validationSeqRef.current[fieldName] === seq) {
            dispatch({ type: 'SET_VALIDATING', field: fieldName, validating: false });
          }
        }
      };

      if (debounceMs > 0) {
        debounceTimeouts.current[fieldName] = setTimeout(
          performValidation,
          debounceMs
        );
      } else {
        await performValidation();
      }
    },
    [dispatch, executeFieldValidators]
  );

  // Async validation for a field
  const validateFieldAsync = useCallback(
    async (fieldName: string, value: any) => {
      const fieldConfig = configRef.current.fields[fieldName];
      if (!fieldConfig?.asyncValidation) return;

      const asyncState = asyncValidationStates.current[fieldName] || {
        isValidating: false
      };

      if (asyncState.isValidating) return;

      const seq = (validationSeqRef.current[fieldName] ?? 0) + 1;
      validationSeqRef.current[fieldName] = seq;

      asyncValidationStates.current[fieldName] = { isValidating: true };
      dispatch({ type: 'SET_VALIDATING', field: fieldName, validating: true });

      try {
        const result = await fieldConfig.asyncValidation(value);

        if (validationSeqRef.current[fieldName] !== seq) return;

        if (!result.isValid && result.message) {
          dispatch({
            type: 'SET_ERRORS',
            field: fieldName,
            errors: [result.message]
          });
        }

        asyncValidationStates.current[fieldName] = {
          isValidating: false,
          error: result.isValid ? undefined : result.message,
          lastValidated: new Date()
        };
      } catch (error) {
        if (validationSeqRef.current[fieldName] !== seq) return;
        console.error(`Async validation error for field ${fieldName}:`, error);
        dispatch({
          type: 'SET_ERRORS',
          field: fieldName,
          errors: ['Validation failed. Please try again.']
        });
        asyncValidationStates.current[fieldName] = {
          isValidating: false,
          error: 'Validation failed',
          lastValidated: new Date()
        };
      } finally {
        if (validationSeqRef.current[fieldName] === seq) {
          dispatch({ type: 'SET_VALIDATING', field: fieldName, validating: false });
        }
      }
    },
    [dispatch]
  );

  // Handle field value change
  const handleChange = useCallback(
    (fieldName: string, value: any) => {
      valuesRef.current = { ...valuesRef.current, [fieldName]: value };
      dispatch({ type: 'SET_VALUE', field: fieldName, value });

      if (configRef.current.validateOnChange !== false) {
        validateFieldByName(fieldName, value);
      }

      const fieldConfig = configRef.current.fields[fieldName];
      if (fieldConfig?.asyncValidation && value) {
        validateFieldAsync(fieldName, value);
      }

      configRef.current.onFieldChange?.(fieldName as keyof T, value, formState);
    },
    [dispatch, validateFieldByName, validateFieldAsync, formState]
  );

  // Handle field blur
  const handleBlur = useCallback(
    (fieldName: string) => {
      dispatch({ type: 'SET_TOUCHED', field: fieldName, touched: true });

      if (configRef.current.validateOnBlur !== false) {
        const value = valuesRef.current[fieldName];
        validateFieldByName(fieldName, value, { immediate: true });
      }
    },
    [dispatch, validateFieldByName]
  );

  // Validate entire form
  const validateForm = useCallback(async (): Promise<{
    isValid: boolean;
    firstErrorField?: string;
  }> => {
    let isValid = true;
    let firstErrorField: string | undefined;

    for (const fieldName of Object.keys(configRef.current.fields)) {
      dispatch({ type: 'SET_TOUCHED', field: fieldName, touched: true });

      const value = valuesRef.current[fieldName];
      const { errors } = await executeFieldValidators(fieldName, value);
      dispatch({ type: 'SET_ERRORS', field: fieldName, errors });

      if (errors.length > 0) {
        isValid = false;
        firstErrorField ??= fieldName;
      }
    }

    setFormState((prev) => ({ ...prev, isValid }));
    return { isValid, firstErrorField };
  }, [dispatch, executeFieldValidators]);

  // Handle form submission
  const handleSubmit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();

      dispatch({ type: 'SET_SUBMITTING', submitting: true });

      const { isValid, firstErrorField } = await validateForm();

      if (isValid) {
        try {
          await configRef.current.onSubmit?.(valuesRef.current);
          dispatch({ type: 'SET_SUBMITTED', submitted: true });

          if (configRef.current.resetOnSubmit) {
            dispatch({ type: 'RESET_FORM' });
          }
        } catch (error) {
          console.error('Form submission error:', error);
        }
      } else if (configRef.current.focusFirstError && firstErrorField) {
        const element = document.querySelector(
          `[name="${firstErrorField}"]`
        ) as HTMLElement | null;
        element?.focus();
      }

      dispatch({ type: 'SET_SUBMITTING', submitting: false });
    },
    [dispatch, validateForm]
  );

  // Reset form
  const resetForm = useCallback(() => {
    dispatch({ type: 'RESET_FORM' });
    Object.keys(debounceTimeouts.current).forEach((key) => {
      clearTimeout(debounceTimeouts.current[key]);
    });
    debounceTimeouts.current = {};
    asyncValidationStates.current = {};
    validationSeqRef.current = {};
  }, [dispatch]);

  // Reset specific field
  const resetField = useCallback(
    (fieldName: string) => {
      dispatch({ type: 'RESET_FIELD', field: fieldName });
      if (debounceTimeouts.current[fieldName]) {
        clearTimeout(debounceTimeouts.current[fieldName]);
      }
      delete asyncValidationStates.current[fieldName];
      delete validationSeqRef.current[fieldName];
    },
    [dispatch]
  );

  // Set multiple values at once
  const setValues = useCallback(
    (values: Partial<T>) => {
      valuesRef.current = { ...valuesRef.current, ...values };
      dispatch({ type: 'SET_FORM_VALUES', values: { ...valuesRef.current } });
    },
    [dispatch]
  );

  // Get field-specific state
  const getFieldState = useCallback(
    (fieldName: string): FieldValidation => {
      return {
        value: formState.values[fieldName],
        errors: formState.errors[fieldName] || [],
        warnings: formState.warnings[fieldName] || [],
        isValid: (formState.errors[fieldName] || []).length === 0,
        isDirty: formState.isDirty,
        isTouched: formState.touched[fieldName] || false,
        isValidating: formState.validating[fieldName] || false
      };
    },
    [formState]
  );

  // Get WCAG-compliant accessibility attributes for a field
  const getFieldA11yProps = useCallback(
    (fieldName: string): FieldA11yProps => {
      const fieldErrors = formState.errors[fieldName] || [];
      const fieldWarnings = formState.warnings[fieldName] || [];
      const isValidating = formState.validating[fieldName] || false;
      const fieldConfig = configRef.current.fields[fieldName];
      const describedBy: string[] = [];

      if (fieldErrors.length > 0) {
        describedBy.push(`${fieldName}-error`);
      }
      if (fieldWarnings.length > 0) {
        describedBy.push(`${fieldName}-warning`);
      }

      return {
        id: `field-${fieldName}`,
        name: fieldName,
        'aria-invalid': fieldErrors.length > 0,
        ...(fieldConfig?.required ? { 'aria-required': true } : {}),
        ...(isValidating ? { 'aria-busy': true } : {}),
        ...(describedBy.length > 0
          ? { 'aria-describedby': describedBy.join(' ') }
          : {})
      };
    },
    [formState.errors, formState.warnings, formState.validating]
  );

  // Check if form has any errors
  const hasErrors = useCallback(() => {
    return Object.values(formState.errors).some((errors) => errors.length > 0);
  }, [formState.errors]);

  // Check if form has any warnings
  const hasWarnings = useCallback(() => {
    return Object.values(formState.warnings).some(
      (warnings) => warnings.length > 0
    );
  }, [formState.warnings]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimeouts.current).forEach((timeout) =>
        clearTimeout(timeout)
      );
    };
  }, []);

  return {
    // State
    formState,

    // Actions
    handleChange,
    handleBlur,
    handleSubmit,
    resetForm,
    resetField,
    setValues,
    validateForm,

    // Utilities
    getFieldState,
    getFieldA11yProps,
    hasErrors,
    hasWarnings,

    // Raw dispatch for advanced usage
    dispatch
  };
};

export default useFormValidation;
