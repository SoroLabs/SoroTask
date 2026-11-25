import { taskCreationSchema, taskFormSchema, EXAMPLE_CONTRACT_ADDRESS } from './taskCreationSchema';
import { createZodFieldValidator, validateFormWithZod } from '../zodValidation';

describe('taskCreationSchema', () => {
  const validValues = {
    contractAddress: EXAMPLE_CONTRACT_ADDRESS,
    functionName: 'harvest_yield',
    interval: 3600,
    gasBalance: 10,
    dueDate: '',
  };

  it('accepts valid task creation values', () => {
    const result = taskCreationSchema.safeParse(validValues);
    expect(result.success).toBe(true);
  });

  it('rejects malformed contract addresses', () => {
    const result = taskCreationSchema.safeParse({
      ...validValues,
      contractAddress: 'GINVALID',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative intervals', () => {
    const result = taskCreationSchema.safeParse({
      ...validValues,
      interval: -100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects intervals below 60 seconds', () => {
    const result = taskCreationSchema.safeParse({
      ...validValues,
      interval: 30,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero interval (contract InvalidInterval)', () => {
    const result = taskCreationSchema.safeParse({
      ...validValues,
      interval: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative gas balance', () => {
    const result = taskCreationSchema.safeParse({
      ...validValues,
      gasBalance: -5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects gas balance above maximum', () => {
    const result = taskCreationSchema.safeParse({
      ...validValues,
      gasBalance: 15000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid function names', () => {
    const result = taskCreationSchema.safeParse({
      ...validValues,
      functionName: 'Invalid-Name',
    });
    expect(result.success).toBe(false);
  });
});

describe('createZodFieldValidator', () => {
  it('returns clear error messages for invalid fields', () => {
    const validator = createZodFieldValidator(taskCreationSchema, 'interval');
    const result = validator.validate(-10);

    expect(result.isValid).toBe(false);
    expect(result.message).toMatch(/greater than zero|whole number|at least/i);
  });
});

describe('validateFormWithZod', () => {
  it('returns per-field errors for invalid form data', () => {
    const errors = validateFormWithZod(taskFormSchema, {
      targetAddress: 'bad-address',
      functionName: '',
      intervalSeconds: -1,
      gasBalance: 0,
    });

    expect(errors.targetAddress?.length).toBeGreaterThan(0);
    expect(errors.functionName?.length).toBeGreaterThan(0);
    expect(errors.intervalSeconds?.length).toBeGreaterThan(0);
    expect(errors.gasBalance?.length).toBeGreaterThan(0);
  });
});
