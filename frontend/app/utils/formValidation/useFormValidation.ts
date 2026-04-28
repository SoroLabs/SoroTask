'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  FormState, 
  FormConfig, 
  FormAction, 
  FieldValidation, 
  AsyncValidationState 
} from './types';
import { validateField } from './validators';

const useFormValidation = <T extends Record<string, any>>(
  config: FormConfig<T>
) => {
  const initialState = (): FormState<T> => {
    const values = {} as T;
    const errors = {} as Record<keyof T, string[]>;
    const warnings = {} as Record<keyof T, string[]>;
    const touched = {} as Record<keyof T, boolean>;
    const validating = {} as Record<keyof T, boolean>;

    // Initialize values from field configs
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
  };

  const [formState, setFormState] = useState<FormState<T>>(initialState);
  const asyncValidationStates = useRef<Record<string, AsyncValidationState>>({});
  const debounceTimeouts = useRef<Record<string, NodeJS.Timeout>>({});

  // Form state reducer
  const formReducer = (state: FormState<T>, action: FormAction): FormState<T> => {
    switch (action.type) {
      case 'SET_VALUE': {
        const newValues = { ...state.values, [action.field]: action.value };
        const newIsDirty = true;
        return { ...state, values: newValues, isDirty: newIsDirty };
      }

      case 'SET_TOUCHED': {
        const newTouched = { ...state.touched, [action.field]: action.touched };
        return { ...state, touched: newTouched };
      }

      case 'SET_ERRORS': {
        const newErrors = { ...state.errors, [action.field]: action.errors };
        return { ...state, errors: newErrors };
      }

      case 'SET_WARNINGS': {
        const newWarnings = { ...state.warnings, [action.field]: action.warnings };
        return { ...state.warnings, [action.field]: action.warnings };
      }

      case 'SET_VALIDATING': {
        const newValidating = { ...state.validating, [action.field]: action.validating };
        return { ...state, validating: newValidating };
      }

      case 'SET_SUBMITTING':
        return { ...state, isSubmitting: action.submitting };

      case 'SET_SUBMITTED':
        return { ...state, isSubmitted: action.submitted };

      case 'RESET_FORM':
        return initialState();

      case 'RESET_FIELD': {
        const fieldConfig = config.fields[action.field];
        const newValues = { ...state.values, [action.field]: fieldConfig?.initialValue };
        const newErrors = { ...state.errors, [action.field]: [] };
        const newWarnings = { ...state.warnings, [action.field]: [] };
        const newTouched = { ...state.touched, [action.field]: false };
        const newValidating = { ...state.validating, [action.field]: false };
        
        return {
          ...state,
          values: newValues,
          errors: newErrors,
          warnings: newWarnings,
          touched: newTouched,
          validating: newValidating
        };
      }

      case 'SET_FORM_VALUES':
        return { ...state, values: action.values as T };

      case 'VALIDATE_FORM':
        return state; // Validation is handled separately

      default:
        return state;
    }
  };

  const dispatch = useCallback((action: FormAction) => {
    setFormState(prevState => formReducer(prevState, action));
  }, []);

  // Validate a single field
  const validateField = useCallback(async (fieldName: string, value: any) => {
    const fieldConfig = config.fields[fieldName];
    if (!fieldConfig?.validation) return;

    // Clear existing timeout for debounced validation
    if (debounceTimeouts.current[fieldName]) {
      clearTimeout(debounceTimeouts.current[fieldName]);
    }

    const debounceMs = fieldConfig.debounceMs || 300;

    const performValidation = async () => {
      dispatch({ type: 'SET_VALIDATING', field: fieldName, validating: true });

      try {
        const { errors, warnings } = await validateField(value, fieldConfig.validation || []);
        
        dispatch({ type: 'SET_ERRORS', field: fieldName, errors });
        dispatch({ type: 'SET_WARNINGS', field: fieldName, warnings });
      } catch (error) {
        console.error(`Validation error for field ${fieldName}:`, error);
        dispatch({ 
          type: 'SET_ERRORS', 
          field: fieldName, 
          errors: ['Validation failed. Please try again.'] 
        });
      } finally {
        dispatch({ type: 'SET_VALIDATING', field: fieldName, validating: false });
      }
    };

    if (debounceMs > 0) {
      debounceTimeouts.current[fieldName] = setTimeout(performValidation, debounceMs);
    } else {
      await performValidation();
    }
  }, [config.fields, dispatch]);

  // Async validation for a field
  const validateFieldAsync = useCallback(async (fieldName: string, value: any) => {
    const fieldConfig = config.fields[fieldName];
    if (!fieldConfig?.asyncValidation) return;

    const asyncState = asyncValidationStates.current[fieldName] || { isValidating: false };
    
    if (asyncState.isValidating) return; // Prevent duplicate async validations

    asyncValidationStates.current[fieldName] = { isValidating: true };
    dispatch({ type: 'SET_VALIDATING', field: fieldName, validating: true });

    try {
      const result = await fieldConfig.asyncValidation(value);
      
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
      dispatch({ type: 'SET_VALIDATING', field: fieldName, validating: false });
    }
  }, [config.fields, dispatch]);

  // Handle field value change
  const handleChange = useCallback((fieldName: string, value: any) => {
    dispatch({ type: 'SET_VALUE', field: fieldName, value });
    
    if (config.validateOnChange !== false) {
      validateField(fieldName, value);
    }

    // Trigger async validation if value is valid and async validation exists
    const fieldConfig = config.fields[fieldName];
    if (fieldConfig?.asyncValidation && value) {
      validateFieldAsync(fieldName, value);
    }

    // Call field change callback
    config.onFieldChange?.(fieldName as keyof T, value, formState);
  }, [config, validateField, validateFieldAsync, formState]);

  // Handle field blur
  const handleBlur = useCallback((fieldName: string) => {
    dispatch({ type: 'SET_TOUCHED', field: fieldName, touched: true });
    
    if (config.validateOnBlur !== false) {
      const value = formState.values[fieldName];
      validateField(fieldName, value);
    }
  }, [config, validateField, formState.values]);

  // Validate entire form
  const validateForm = useCallback(async () => {
    let isValid = true;
    
    for (const fieldName of Object.keys(config.fields)) {
      const value = formState.values[fieldName];
      await validateField(fieldName, value);
      
      const fieldErrors = formState.errors[fieldName];
      if (fieldErrors && fieldErrors.length > 0) {
        isValid = false;
      }
    }

    // Update overall form validity
    setFormState(prev => ({ ...prev, isValid }));
    return isValid;
  }, [config.fields, validateField, formState.errors]);

  // Handle form submission
  const handleSubmit = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    
    dispatch({ type: 'SET_SUBMITTING', submitting: true });
    
    const isValid = await validateForm();
    
    if (isValid) {
      try {
        await config.onSubmit?.(formState.values);
        dispatch({ type: 'SET_SUBMITTED', submitted: true });
        
        if (config.resetOnSubmit) {
          dispatch({ type: 'RESET_FORM' });
        }
      } catch (error) {
        console.error('Form submission error:', error);
        // Handle submission error (could be added to form state)
      }
    } else {
      // Focus first error field if configured
      if (config.focusFirstError) {
        const firstErrorField = Object.keys(formState.errors).find(
          field => formState.errors[field as keyof T]?.length > 0
        );
        if (firstErrorField) {
          const element = document.querySelector(`[name="${firstErrorField}"]`) as HTMLElement;
          element?.focus();
        }
      }
    }
    
    dispatch({ type: 'SET_SUBMITTING', submitting: false });
  }, [config, validateForm, formState.errors]);

  // Reset form
  const resetForm = useCallback(() => {
    dispatch({ type: 'RESET_FORM' });
    Object.keys(debounceTimeouts.current).forEach(key => {
      clearTimeout(debounceTimeouts.current[key]);
    });
    debounceTimeouts.current = {};
    asyncValidationStates.current = {};
  }, [dispatch]);

  // Reset specific field
  const resetField = useCallback((fieldName: string) => {
    dispatch({ type: 'RESET_FIELD', field: fieldName });
    if (debounceTimeouts.current[fieldName]) {
      clearTimeout(debounceTimeouts.current[fieldName]);
    }
    delete asyncValidationStates.current[fieldName];
  }, [dispatch]);

  // Set multiple values at once
  const setValues = useCallback((values: Partial<T>) => {
    dispatch({ type: 'SET_FORM_VALUES', values: { ...formState.values, ...values } });
  }, [dispatch, formState.values]);

  // Get field-specific state
  const getFieldState = useCallback((fieldName: string): FieldValidation => {
    return {
      value: formState.values[fieldName],
      errors: formState.errors[fieldName] || [],
      warnings: formState.warnings[fieldName] || [],
      isValid: (formState.errors[fieldName] || []).length === 0,
      isDirty: formState.isDirty,
      isTouched: formState.touched[fieldName] || false,
      isValidating: formState.validating[fieldName] || false
    };
  }, [formState]);

  // Check if form has any errors
  const hasErrors = useCallback(() => {
    return Object.values(formState.errors).some(errors => errors.length > 0);
  }, [formState.errors]);

  // Check if form has any warnings
  const hasWarnings = useCallback(() => {
    return Object.values(formState.warnings).some(warnings => warnings.length > 0);
  }, [formState.warnings]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimeouts.current).forEach(timeout => clearTimeout(timeout));
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
    hasErrors,
    hasWarnings,
    
    // Raw dispatch for advanced usage
    dispatch
  };
};

export default useFormValidation;
