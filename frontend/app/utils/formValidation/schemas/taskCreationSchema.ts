import { z } from 'zod';

/** Stellar Soroban contract address: C followed by 55 alphanumeric chars. */
export const STELLAR_CONTRACT_ADDRESS_REGEX = /^C[A-Z0-9]{55}$/;

/** Soroban function name: lowercase snake_case identifier. */
export const FUNCTION_NAME_REGEX = /^[a-z_][a-z0-9_]*$/;

export const MIN_INTERVAL_SECONDS = 60;
export const MIN_GAS_BALANCE_XLM = 0.1;
export const MAX_GAS_BALANCE_XLM = 10000;

/** Valid example Soroban contract address for tests and mocks (C + 55 chars). */
export const EXAMPLE_CONTRACT_ADDRESS =
  'C1234567890ABCDEF1234567890ABCDEF1234567890ABCDE00000000';

export const taskCreationSchema = z.object({
  contractAddress: z
    .string()
    .min(1, 'Contract address is required')
    .regex(
      STELLAR_CONTRACT_ADDRESS_REGEX,
      'Please enter a valid contract address (C followed by 55 characters)'
    ),
  functionName: z
    .string()
    .min(1, 'Function name is required')
    .regex(
      FUNCTION_NAME_REGEX,
      'Function name must contain only lowercase letters, numbers, and underscores'
    ),
  interval: z.coerce
    .number()
    .refine((value) => Number.isFinite(value), 'Interval must be a valid number')
    .refine((value) => Number.isInteger(value), 'Interval must be a whole number')
    .refine((value) => value > 0, 'Interval must be greater than zero')
    .refine(
      (value) => value >= MIN_INTERVAL_SECONDS,
      `Interval must be at least ${MIN_INTERVAL_SECONDS} seconds`
    ),
  gasBalance: z.coerce
    .number()
    .refine((value) => Number.isFinite(value), 'Gas balance must be a valid number')
    .refine((value) => value > 0, 'Gas balance must be greater than zero')
    .refine(
      (value) => value >= MIN_GAS_BALANCE_XLM,
      `Gas balance must be at least ${MIN_GAS_BALANCE_XLM} XLM`
    )
    .refine(
      (value) => value <= MAX_GAS_BALANCE_XLM,
      `Gas balance must be no more than ${MAX_GAS_BALANCE_XLM} XLM`
    ),
  dueDate: z.string().optional(),
});

export type TaskCreationFormValues = z.infer<typeof taskCreationSchema>;

export const taskFormSchema = z.object({
  targetAddress: taskCreationSchema.shape.contractAddress,
  functionName: taskCreationSchema.shape.functionName,
  intervalSeconds: taskCreationSchema.shape.interval,
  gasBalance: taskCreationSchema.shape.gasBalance,
});

export type TaskFormSchemaValues = z.infer<typeof taskFormSchema>;
