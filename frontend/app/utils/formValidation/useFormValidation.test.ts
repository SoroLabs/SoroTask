import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useFormValidation from './useFormValidation';
import { taskCreationFormConfig } from './formConfigs';

// Mock async validation
vi.mock('./validators', () => ({
  required: (message?: string) => ({
    validate: (value: any) => ({
      isValid: value !== null && value !== undefined && value !== '',
      message: message || 'This field is required'
    }),
    required: true
  }),
  contractAddress: () => ({
    validate: (value: string) => ({
      isValid: !value || /^C[A-Z0-9]{55}$/.test(value),
      message: 'Please enter a valid contract address (C...)'
    })
  }),
  functionName: () => ({
    validate: (value: string) => ({
      isValid: !value || /^[a-z_][a-z0-9_]*$/.test(value),
      message: 'Function name must contain only lowercase letters, numbers, and underscores'
    })
  }),
  intervalSeconds: () => ({
    validate: (value: number) => ({
      isValid: !value || (!isNaN(Number(value)) && Number(value) >= 60),
      message: 'Interval must be at least 60 seconds'
    })
  }),
  gasBalance: () => ({
    validate: (value: number) => {
      const numValue = Number(value);
      return {
        isValid: !value || (!isNaN(numValue) && numValue > 0 && numValue <= 10000),
        message: 'Gas balance must be between 0 and 10000 XLM'
      };
    }
  })
}));

describe('useFormValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      expect(result.current.formState.values).toEqual({
        contractAddress: '',
        functionName: '',
        interval: '',
        gasBalance: '',
        dueDate: ''
      });
      expect(result.current.formState.isValid).toBe(true);
      expect(result.current.formState.isDirty).toBe(false);
      expect(result.current.formState.isSubmitting).toBe(false);
      expect(result.current.formState.isSubmitted).toBe(false);
    });

    it('should initialize with custom initial values', () => {
      const customConfig = {
        ...taskCreationFormConfig,
        fields: {
          ...taskCreationFormConfig.fields,
          contractAddress: {
            ...taskCreationFormConfig.fields.contractAddress,
            initialValue: 'C1234567890ABCDEF1234567890ABCDEF12345678'
          }
        }
      };

      const { result } = renderHook(() => useFormValidation(customConfig));

      expect(result.current.formState.values.contractAddress).toBe('C1234567890ABCDEF1234567890ABCDEF12345678');
    });
  });

  describe('Field Changes', () => {
    it('should update field value on change', () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('contractAddress', 'C1234567890ABCDEF1234567890ABCDEF12345678');
      });

      expect(result.current.formState.values.contractAddress).toBe('C1234567890ABCDEF1234567890ABCDEF12345678');
      expect(result.current.formState.isDirty).toBe(true);
    });

    it('should mark field as touched on blur', () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleBlur('contractAddress');
      });

      expect(result.current.formState.touched.contractAddress).toBe(true);
    });

    it('should validate field on change when enabled', () => {
      const configWithValidation = {
        ...taskCreationFormConfig,
        validateOnChange: true
      };
      const { result } = renderHook(() => useFormValidation(configWithValidation));

      act(() => {
        result.current.handleChange('contractAddress', 'invalid');
      });

      // Should have validation errors after async validation completes
      expect(result.current.formState.validating.contractAddress).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should validate required fields', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('contractAddress', '');
        result.current.handleBlur('contractAddress');
      });

      // Wait for validation to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.current.formState.errors.contractAddress).toContain('Contract address is required');
      expect(result.current.formState.isValid).toBe(false);
    });

    it('should validate contract address format', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('contractAddress', 'invalid-address');
        result.current.handleBlur('contractAddress');
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.current.formState.errors.contractAddress).toContain('Please enter a valid contract address (C...)');
    });

    it('should validate function name format', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('functionName', 'Invalid-Name');
        result.current.handleBlur('functionName');
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.current.formState.errors.functionName).toContain('Function name must contain only lowercase letters, numbers, and underscores');
    });

    it('should validate interval minimum value', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('interval', 30);
        result.current.handleBlur('interval');
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.current.formState.errors.interval).toContain('Interval must be at least 60 seconds');
    });

    it('should validate gas balance range', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('gasBalance', 15000);
        result.current.handleBlur('gasBalance');
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.current.formState.errors.gasBalance).toContain('Gas balance must be between 0 and 10000 XLM');
    });

    it('should pass validation for valid inputs', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('contractAddress', 'C1234567890ABCDEF1234567890ABCDEF12345678');
        result.current.handleChange('functionName', 'harvest_yield');
        result.current.handleChange('interval', 3600);
        result.current.handleChange('gasBalance', 10);
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.current.hasErrors()).toBe(false);
      expect(result.current.formState.isValid).toBe(true);
    });
  });

  describe('Form Submission', () => {
    it('should not submit with validation errors', async () => {
      const mockSubmit = vi.fn();
      const configWithSubmit = {
        ...taskCreationFormConfig,
        onSubmit: mockSubmit
      };

      const { result } = renderHook(() => useFormValidation(configWithSubmit));

      act(() => {
        result.current.handleChange('contractAddress', '');
        result.current.handleBlur('contractAddress');
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      act(() => {
        result.current.handleSubmit();
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockSubmit).not.toHaveBeenCalled();
      expect(result.current.formState.isSubmitting).toBe(false);
    });

    it('should submit with valid data', async () => {
      const mockSubmit = vi.fn().mockResolvedValue(undefined);
      const configWithSubmit = {
        ...taskCreationFormConfig,
        onSubmit: mockSubmit
      };

      const { result } = renderHook(() => useFormValidation(configWithSubmit));

      act(() => {
        result.current.handleChange('contractAddress', 'C1234567890ABCDEF1234567890ABCDEF12345678');
        result.current.handleChange('functionName', 'harvest_yield');
        result.current.handleChange('interval', 3600);
        result.current.handleChange('gasBalance', 10);
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      act(() => {
        result.current.handleSubmit();
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(mockSubmit).toHaveBeenCalledWith({
        contractAddress: 'C1234567890ABCDEF1234567890ABCDEF12345678',
        functionName: 'harvest_yield',
        interval: 3600,
        gasBalance: 10,
        dueDate: ''
      });
      expect(result.current.formState.isSubmitted).toBe(true);
    });

    it('should handle submission errors', async () => {
      const mockSubmit = vi.fn().mockRejectedValue(new Error('Submission failed'));
      const configWithSubmit = {
        ...taskCreationFormConfig,
        onSubmit: mockSubmit
      };

      const { result } = renderHook(() => useFormValidation(configWithSubmit));

      act(() => {
        result.current.handleChange('contractAddress', 'C1234567890ABCDEF1234567890ABCDEF12345678');
        result.current.handleChange('functionName', 'harvest_yield');
        result.current.handleChange('interval', 3600);
        result.current.handleChange('gasBalance', 10);
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      act(() => {
        result.current.handleSubmit();
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(result.current.formState.isSubmitting).toBe(false);
      expect(result.current.formState.isSubmitted).toBe(false);
    });
  });

  describe('Form Reset', () => {
    it('should reset form to initial state', () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('contractAddress', 'C1234567890ABCDEF1234567890ABCDEF12345678');
        result.current.handleChange('functionName', 'test_function');
        result.current.handleBlur('contractAddress');
        result.current.handleBlur('functionName');
      });

      act(() => {
        result.current.resetForm();
      });

      expect(result.current.formState.values).toEqual({
        contractAddress: '',
        functionName: '',
        interval: '',
        gasBalance: '',
        dueDate: ''
      });
      expect(result.current.formState.isDirty).toBe(false);
      expect(result.current.formState.isSubmitted).toBe(false);
      expect(result.current.formState.touched).toEqual({
        contractAddress: false,
        functionName: false,
        interval: false,
        gasBalance: false,
        dueDate: false
      });
    });

    it('should reset individual field', () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('contractAddress', 'C1234567890ABCDEF1234567890ABCDEF12345678');
        result.current.handleBlur('contractAddress');
      });

      act(() => {
        result.current.resetField('contractAddress');
      });

      expect(result.current.formState.values.contractAddress).toBe('');
      expect(result.current.formState.touched.contractAddress).toBe(false);
      expect(result.current.formState.errors.contractAddress).toEqual([]);
    });
  });

  describe('Field State Utilities', () => {
    it('should get field state correctly', () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('contractAddress', 'test');
        result.current.handleBlur('contractAddress');
      });

      const fieldState = result.current.getFieldState('contractAddress');

      expect(fieldState.value).toBe('test');
      expect(fieldState.isTouched).toBe(true);
      expect(fieldState.isDirty).toBe(true);
    });

    it('should detect form errors correctly', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      expect(result.current.hasErrors()).toBe(false);

      act(() => {
        result.current.handleChange('contractAddress', '');
        result.current.handleBlur('contractAddress');
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.current.hasErrors()).toBe(true);
    });

    it('should set multiple values at once', () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.setValues({
          contractAddress: 'C1234567890ABCDEF1234567890ABCDEF12345678',
          functionName: 'test_function'
        });
      });

      expect(result.current.formState.values.contractAddress).toBe('C1234567890ABCDEF1234567890ABCDEF12345678');
      expect(result.current.formState.values.functionName).toBe('test_function');
    });
  });

  describe('Async Validation', () => {
    it('should handle async validation', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('contractAddress', 'CINVALID');
      });

      // Should be validating
      expect(result.current.formState.validating.contractAddress).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should have async validation error
      expect(result.current.formState.errors.contractAddress).toContain('Contract not found or invalid');
      expect(result.current.formState.validating.contractAddress).toBe(false);
    });

    it('should prevent duplicate async validations', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      act(() => {
        result.current.handleChange('contractAddress', 'C1234567890ABCDEF1234567890ABCDEF12345678');
        result.current.handleChange('contractAddress', 'C1234567890ABCDEF1234567890ABCDEF12345678'); // Same value
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Should only validate once
      expect(result.current.formState.validating.contractAddress).toBe(false);
    });
  });

  describe('Debounced Validation', () => {
    it('should debounce validation when configured', async () => {
      const configWithDebounce = {
        ...taskCreationFormConfig,
        fields: {
          ...taskCreationFormConfig.fields,
          contractAddress: {
            ...taskCreationFormConfig.fields.contractAddress,
            debounceMs: 300
          }
        }
      };

      const { result } = renderHook(() => useFormValidation(configWithDebounce));

      act(() => {
        result.current.handleChange('contractAddress', 'test');
      });

      // Should not validate immediately
      expect(result.current.formState.validating.contractAddress).toBe(false);

      // Should validate after debounce
      await new Promise(resolve => setTimeout(resolve, 350));
      expect(result.current.formState.validating.contractAddress).toBe(true);
    });
  });
});
