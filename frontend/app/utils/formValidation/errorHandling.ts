export type FormError = {
  code: string;
  message: string;
  field?: string;
  severity: 'error' | 'warning' | 'info';
};

export type FormSubmissionState = {
  isSubmitting: boolean;
  isSubmitted: boolean;
  submissionError?: FormError;
  submissionSuccess?: {
    message: string;
    data?: any;
  };
  retryCount: number;
  lastSubmitTime?: Date;
};

export class FormErrorHandler {
  private maxRetries = 3;
  private retryDelay = 1000; // 1 second

  constructor(maxRetries?: number, retryDelay?: number) {
    if (maxRetries) this.maxRetries = maxRetries;
    if (retryDelay) this.retryDelay = retryDelay;
  }

  /**
   * Parse API errors and convert to form errors
   */
  parseApiError(error: any): FormError[] {
    const errors: FormError[] = [];

    if (error?.response?.data?.errors) {
      // Handle structured validation errors
      error.response.data.errors.forEach((err: any) => {
        errors.push({
          code: err.code || 'VALIDATION_ERROR',
          message: err.message || err.detail || 'Validation failed',
          field: err.field || err.path?.join('.'),
          severity: 'error'
        });
      });
    } else if (error?.response?.data?.message) {
      // Handle single error message
      errors.push({
        code: error.response.data.code || 'API_ERROR',
        message: error.response.data.message,
        severity: 'error'
      });
    } else if (error?.message) {
      // Handle generic error
      errors.push({
        code: 'UNKNOWN_ERROR',
        message: error.message,
        severity: 'error'
      });
    } else {
      // Handle unknown errors
      errors.push({
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred. Please try again.',
        severity: 'error'
      });
    }

    return errors;
  }

  /**
   * Determine if error is retryable
   */
  isRetryableError(error: FormError): boolean {
    const retryableCodes = [
      'NETWORK_ERROR',
      'TIMEOUT_ERROR',
      'SERVER_ERROR',
      'RATE_LIMIT_ERROR'
    ];

    return retryableCodes.includes(error.code) || 
           error.message.toLowerCase().includes('network') ||
           error.message.toLowerCase().includes('timeout') ||
           error.message.toLowerCase().includes('server error');
  }

  /**
   * Check if retry should be attempted
   */
  shouldRetry(state: FormSubmissionState, error: FormError): boolean {
    if (state.retryCount >= this.maxRetries) {
      return false;
    }

    if (!this.isRetryableError(error)) {
      return false;
    }

    // Add exponential backoff
    const timeSinceLastSubmit = state.lastSubmitTime 
      ? Date.now() - state.lastSubmitTime.getTime()
      : 0;

    const requiredDelay = this.retryDelay * Math.pow(2, state.retryCount);
    
    return timeSinceLastSubmit >= requiredDelay;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  getRetryDelay(retryCount: number): number {
    return this.retryDelay * Math.pow(2, retryCount);
  }

  /**
   * Create user-friendly error messages
   */
  getUserFriendlyMessage(error: FormError): string {
    const messageMap: Record<string, string> = {
      'VALIDATION_ERROR': 'Please check your input and try again.',
      'NETWORK_ERROR': 'Network connection failed. Please check your internet connection.',
      'TIMEOUT_ERROR': 'Request timed out. Please try again.',
      'SERVER_ERROR': 'Server is temporarily unavailable. Please try again later.',
      'RATE_LIMIT_ERROR': 'Too many requests. Please wait a moment and try again.',
      'UNAUTHORIZED': 'You are not authorized to perform this action.',
      'FORBIDDEN': 'You do not have permission to perform this action.',
      'NOT_FOUND': 'The requested resource was not found.',
      'CONFLICT': 'This resource conflicts with existing data.'
    };

    return messageMap[error.code] || error.message;
  }

  /**
   * Get field-specific error message
   */
  getFieldErrorMessage(error: FormError, fieldLabel: string): string {
    if (error.field) {
      return `${fieldLabel}: ${this.getUserFriendlyMessage(error)}`;
    }
    return this.getUserFriendlyMessage(error);
  }

  /**
   * Create submission success message
   */
  createSuccessMessage(action: string, data?: any): string {
    const messages = {
      'create': `${data?.name || 'Item'} created successfully!`,
      'update': `${data?.name || 'Item'} updated successfully!`,
      'delete': `${data?.name || 'Item'} deleted successfully!`,
      'submit': 'Form submitted successfully!',
      'default': 'Operation completed successfully!'
    };

    return messages[action as keyof typeof messages] || messages.default;
  }

  /**
   * Handle form submission with error handling and retries
   */
  async handleSubmit<T>(
    submitFn: () => Promise<T>,
    state: FormSubmissionState,
    onSuccess?: (data: T) => void,
    onError?: (errors: FormError[]) => void
  ): Promise<{ success: boolean; data?: T; errors?: FormError[] }> {
    try {
      const data = await submitFn();
      
      return {
        success: true,
        data
      };
    } catch (error) {
      const errors = this.parseApiError(error);
      
      if (onError) {
        onError(errors);
      }

      return {
        success: false,
        errors
      };
    }
  }

  /**
   * Create form state with error handling
   */
  createFormState(): FormSubmissionState {
    return {
      isSubmitting: false,
      isSubmitted: false,
      retryCount: 0
    };
  }

  /**
   * Reset form state
   */
  resetFormState(): FormSubmissionState {
    return {
      isSubmitting: false,
      isSubmitted: false,
      retryCount: 0
    };
  }

  /**
   * Update form state for submission start
   */
  startSubmission(state: FormSubmissionState): FormSubmissionState {
    return {
      ...state,
      isSubmitting: true,
      submissionError: undefined,
      lastSubmitTime: new Date()
    };
  }

  /**
   * Update form state for successful submission
   */
  completeSubmission<T>(
    state: FormSubmissionState, 
    data?: T,
    message?: string
  ): FormSubmissionState {
    return {
      ...state,
      isSubmitting: false,
      isSubmitted: true,
      submissionSuccess: {
        message: message || this.createSuccessMessage('submit', data),
        data
      },
      retryCount: 0
    };
  }

  /**
   * Update form state for failed submission
   */
  failSubmission(
    state: FormSubmissionState,
    errors: FormError[]
  ): FormSubmissionState {
    return {
      ...state,
      isSubmitting: false,
      submissionError: errors[0], // Primary error
      retryCount: state.retryCount + 1
    };
  }
}

// Default error handler instance
export const defaultErrorHandler = new FormErrorHandler();

// Utility functions
export const createFormError = (
  code: string, 
  message: string, 
  field?: string, 
  severity: FormError['severity'] = 'error'
): FormError => ({
  code,
  message,
  field,
  severity
});

export const isNetworkError = (error: any): boolean => {
  return error?.code === 'NETWORK_ERROR' || 
         error?.message?.toLowerCase().includes('network') ||
         error?.message?.toLowerCase().includes('fetch');
};

export const isValidationError = (error: any): boolean => {
  return error?.code === 'VALIDATION_ERROR' ||
         error?.response?.status === 400 ||
         error?.response?.status === 422;
};

export const isServerError = (error: any): boolean => {
  const status = error?.response?.status;
  return status >= 500 && status < 600;
};

export const isAuthError = (error: any): boolean => {
  const status = error?.response?.status;
  return status === 401 || status === 403;
};
