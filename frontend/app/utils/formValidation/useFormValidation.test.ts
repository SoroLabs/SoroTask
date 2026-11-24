import { renderHook, act } from '@testing-library/react';
import useFormValidation, { createFormConfigFromAbi } from './useFormValidation';
import { taskCreationFormConfig } from './formConfigs';
import { EXAMPLE_CONTRACT_ADDRESS } from './schemas/taskCreationSchema';
import type { AbiFunction } from '../../../src/lib/abi-form';

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

  describe('ABI Dynamic Form Generation & Accessibility', () => {
    const swapAbiFn: AbiFunction = {
      name: 'swap',
      inputs: [
        { name: 'token', type: 'symbol' },
        { name: 'amount_in', type: 'u64' },
        {
          name: 'route',
          type: 'vec',
          specType: { type: 'vec', elementType: 'address' }
        }
      ],
      outputs: []
    };

    it('should auto-generate form fields and validate live from AbiFunction', async () => {
      const abiConfig = createFormConfigFromAbi(swapAbiFn);
      const { result } = renderHook(() => useFormValidation(abiConfig));

      expect(Object.keys(result.current.formState.values)).toEqual([
        'token',
        'amount_in',
        'route'
      ]);

      await act(async () => {
        result.current.handleChange('amount_in', '-50');
        result.current.handleBlur('amount_in');
      });

      expect(result.current.formState.errors.amount_in.length).toBeGreaterThan(0);
      expect(result.current.formState.isValid).toBe(false);

      const a11y = result.current.getFieldA11yProps('amount_in');
      expect(a11y['aria-invalid']).toBe(true);
      expect(a11y['aria-required']).toBe(true);
      expect(a11y['aria-describedby']).toBe('amount_in-error');
    });

    it('should re-initialize form fields when dynamic ABI config changes', () => {
      const firstConfig = createFormConfigFromAbi(swapAbiFn);
      const secondFn: AbiFunction = {
        name: 'pause',
        inputs: [{ name: 'reason', type: 'string' }],
        outputs: []
      };
      const secondConfig = createFormConfigFromAbi(secondFn);

      const { result, rerender } = renderHook(
        ({ cfg }) => useFormValidation(cfg),
        { initialProps: { cfg: firstConfig } }
      );

      expect(Object.keys(result.current.formState.values)).toEqual([
        'token',
        'amount_in',
        'route'
      ]);

      rerender({ cfg: secondConfig });

      expect(Object.keys(result.current.formState.values)).toEqual(['reason']);
    });
  });
});
