import { ValidationRule, ValidationResult } from './types';
import { parseUnits } from '../../../src/lib/tokenAmounts';

// Common validation rules
export const required = (message?: string): ValidationRule => ({
  validate: (value: any) => ({
    isValid: value !== null && value !== undefined && value !== '',
    message: message || 'This field is required'
  }),
  required: true
});

export const minLength = (min: number, message?: string): ValidationRule<string> => ({
  validate: (value: string) => ({
    isValid: !value || value.length >= min,
    message: message || `Must be at least ${min} characters`
  })
});

export const maxLength = (max: number, message?: string): ValidationRule<string> => ({
  validate: (value: string) => ({
    isValid: !value || value.length <= max,
    message: message || `Must be no more than ${max} characters`
  })
});

export const email = (message?: string): ValidationRule<string> => ({
  validate: (value: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return {
      isValid: !value || emailRegex.test(value),
      message: message || 'Please enter a valid email address'
    };
  }
});

export const pattern = (regex: RegExp, message?: string): ValidationRule<string> => ({
  validate: (value: string) => ({
    isValid: !value || regex.test(value),
    message: message || 'Invalid format'
  })
});

export const number = (message?: string): ValidationRule<any> => ({
  validate: (value: any) => ({
    isValid: !value || !isNaN(Number(value)),
    message: message || 'Must be a valid number'
  })
});

export const min = (min: number, message?: string): ValidationRule<number> => ({
  validate: (value: number) => ({
    isValid: !value || value >= min,
    message: message || `Must be at least ${min}`
  })
});

export const max = (max: number, message?: string): ValidationRule<number> => ({
  validate: (value: number) => ({
    isValid: !value || value <= max,
    message: message || `Must be no more than ${max}`
  })
});

export const positive = (message?: string): ValidationRule<number> => ({
  validate: (value: number) => ({
    isValid: !value || value > 0,
    message: message || 'Must be a positive number'
  })
});

export const nonNegative = (message?: string): ValidationRule<number> => ({
  validate: (value: number) => ({
    isValid: !value || value >= 0,
    message: message || 'Must be zero or positive'
  })
});

export const integer = (message?: string): ValidationRule<number> => ({
  validate: (value: number) => ({
    isValid: !value || Number.isInteger(Number(value)),
    message: message || 'Must be a whole number'
  })
});

export const url = (message?: string): ValidationRule<string> => ({
  validate: (value: string) => {
    try {
      new URL(value);
      return { isValid: true };
    } catch {
      return {
        isValid: !value,
        message: message || 'Please enter a valid URL'
      };
    }
  }
});

export const ethereumAddress = (message?: string): ValidationRule<string> => ({
  validate: (value: string) => {
    const ethRegex = /^0x[a-fA-F0-9]{40}$/;
    return {
      isValid: !value || ethRegex.test(value),
      message: message || 'Please enter a valid Ethereum address (0x...)'
    };
  }
});

export const stellarAddress = (message?: string): ValidationRule<string> => ({
  validate: (value: string) => {
    const stellarRegex = /^G[A-Z0-9]{55}$/;
    return {
      isValid: !value || stellarRegex.test(value),
      message: message || 'Please enter a valid Stellar address (G...)'
    };
  }
});

// Composite validators
export const contractAddress = (message?: string): ValidationRule<string> => ({
  validate: (value: string) => {
    const stellarRegex = /^C[A-Z0-9]{55}$/;
    return {
      isValid: !value || stellarRegex.test(value),
      message: message || 'Please enter a valid contract address (C...)'
    };
  }
});

export const functionName = (message?: string): ValidationRule<string> => ({
  validate: (value: string) => {
    const functionRegex = /^[a-z_][a-z0-9_]*$/;
    return {
      isValid: !value || functionRegex.test(value),
      message: message || 'Function name must contain only lowercase letters, numbers, and underscores'
    };
  }
});

export const gasBalance = (message?: string): ValidationRule<string | number> => ({
  validate: (value: string | number) => {
    const errorMessage = message || 'Gas balance must be an exact amount between 0 and 10000 XLM';
    if (value === '') {
      return { isValid: true, message: errorMessage };
    }
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) {
      return { isValid: false, message: errorMessage };
    }
    try {
      const stroops = parseUnits(String(value));
      const maxStroops = 10000n * 10n ** 7n;
    return {
        isValid: stroops > 0n && stroops <= maxStroops,
        message: errorMessage
      };
    } catch {
      return {
        isValid: false,
        message: errorMessage
      };
    }
  }
});

export const intervalSeconds = (message?: string): ValidationRule<number> => ({
  validate: (value: number) => {
    const numValue = Number(value);
    return {
      isValid: !value || (!isNaN(numValue) && numValue >= 60),
      message: message || 'Interval must be at least 60 seconds'
    };
  }
});

// Async validators
export const uniqueEmail = async (email: string): Promise<ValidationResult> => {
  // Mock async validation - in real app, this would call an API
  await new Promise(resolve => setTimeout(resolve, 500));
  const takenEmails = ['admin@example.com', 'user@example.com'];
  return {
    isValid: !takenEmails.includes(email),
    message: takenEmails.includes(email) ? 'This email is already taken' : undefined
  };
};

export const validContract = async (address: string): Promise<ValidationResult> => {
  // Mock async validation - in real app, this would verify contract exists
  await new Promise(resolve => setTimeout(resolve, 1000));
  const validContracts = [
    'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  ];
  return {
    isValid: validContracts.includes(address),
    message: validContracts.includes(address) ? undefined : 'Contract not found or invalid'
  };
};

// Utility functions
export const validateField = async <T>(
  value: T,
  rules: ValidationRule<T>[]
): Promise<{ errors: string[]; warnings: string[] }> => {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of rules) {
    const result = rule.validate(value);
    if (!result.isValid && result.message) {
      errors.push(result.message);
    }
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  return { errors, warnings };
};

export const compose = (...rules: ValidationRule[]): ValidationRule => ({
  validate: (value: any) => {
    for (const rule of rules) {
      const result = rule.validate(value);
      if (!result.isValid) {
        return result;
      }
    }
    return { isValid: true };
  }
});

export const conditional = (
  condition: (value: any) => boolean,
  rule: ValidationRule
): ValidationRule => ({
  validate: (value: any) => {
    if (condition(value)) {
      return rule.validate(value);
    }
    return { isValid: true };
  }
});
