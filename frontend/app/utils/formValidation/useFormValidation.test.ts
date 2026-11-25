import { renderHook, act } from '@testing-library/react';
import useFormValidation from './useFormValidation';
import { taskCreationFormConfig } from './formConfigs';
import { EXAMPLE_CONTRACT_ADDRESS } from './schemas/taskCreationSchema';

const waitForValidation = () => new Promise(resolve => setTimeout(resolve, 600));

describe('useFormValidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    });
  });

  describe('Validation', () => {
    it('should validate required fields', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      await act(async () => {
        result.current.handleChange('contractAddress', '');
        result.current.handleBlur('contractAddress');
        await waitForValidation();
      });

      expect(result.current.formState.errors.contractAddress).toContain('Contract address is required');
    });

    it('should validate contract address format', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      await act(async () => {
        result.current.handleChange('contractAddress', 'invalid-address');
        result.current.handleBlur('contractAddress');
        await waitForValidation();
      });

      expect(result.current.formState.errors.contractAddress.some((msg) =>
        msg.includes('valid contract address')
      )).toBe(true);
    });

    it('should validate function name format', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      await act(async () => {
        result.current.handleChange('functionName', 'Invalid-Name');
        result.current.handleBlur('functionName');
        await waitForValidation();
      });

      expect(result.current.formState.errors.functionName).toContain(
        'Function name must contain only lowercase letters, numbers, and underscores'
      );
    });

    it('should validate interval minimum value', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      await act(async () => {
        result.current.handleChange('interval', 30);
        result.current.handleBlur('interval');
        await waitForValidation();
      });

      expect(result.current.formState.errors.interval.some((msg) =>
        msg.includes('60 seconds')
      )).toBe(true);
    });

    it('should reject negative intervals', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      await act(async () => {
        result.current.handleChange('interval', -100);
        result.current.handleBlur('interval');
        await waitForValidation();
      });

      expect(result.current.formState.errors.interval.some((msg) =>
        msg.includes('greater than zero') || msg.includes('whole number')
      )).toBe(true);
    });

    it('should validate gas balance range', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      await act(async () => {
        result.current.handleChange('gasBalance', 15000);
        result.current.handleBlur('gasBalance');
        await waitForValidation();
      });

      expect(result.current.formState.errors.gasBalance.some((msg) =>
        msg.includes('10000')
      )).toBe(true);
    });

    it('should pass validation for valid inputs', async () => {
      const { result } = renderHook(() => useFormValidation(taskCreationFormConfig));

      await act(async () => {
        result.current.handleChange('contractAddress', EXAMPLE_CONTRACT_ADDRESS);
        result.current.handleChange('functionName', 'harvest_yield');
        result.current.handleChange('interval', 3600);
        result.current.handleChange('gasBalance', 10);
        await waitForValidation();
      });

      expect(result.current.hasErrors()).toBe(false);
    });
  });

  describe('Form Submission', () => {
    it('should not submit with validation errors', async () => {
      const mockSubmit = jest.fn();
      const configWithSubmit = {
        ...taskCreationFormConfig,
        onSubmit: mockSubmit
      };

      const { result } = renderHook(() => useFormValidation(configWithSubmit));

      await act(async () => {
        result.current.handleChange('contractAddress', '');
        await result.current.handleSubmit();
      });

      expect(mockSubmit).not.toHaveBeenCalled();
      expect(result.current.formState.touched.contractAddress).toBe(true);
    });

    it('should submit with valid data', async () => {
      const mockSubmit = jest.fn().mockResolvedValue(undefined);
      const configWithSubmit = {
        ...taskCreationFormConfig,
        onSubmit: mockSubmit
      };

      const { result } = renderHook(() => useFormValidation(configWithSubmit));

      await act(async () => {
        result.current.handleChange('contractAddress', EXAMPLE_CONTRACT_ADDRESS);
        result.current.handleChange('functionName', 'harvest_yield');
        result.current.handleChange('interval', 3600);
        result.current.handleChange('gasBalance', 10);
        await result.current.handleSubmit();
      });

      expect(mockSubmit).toHaveBeenCalledWith({
        contractAddress: EXAMPLE_CONTRACT_ADDRESS,
        functionName: 'harvest_yield',
        interval: 3600,
        gasBalance: 10,
        dueDate: ''
      });
      expect(result.current.formState.isSubmitted).toBe(true);
    });
  });
});
