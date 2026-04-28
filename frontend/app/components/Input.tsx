import React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  error?: boolean;
  label?: string;
  helperText?: string;
}

/**
 * Reusable Input component using design tokens.
 * 
 * Usage:
 * ```tsx
 * <Input 
 *   size="md"
 *   placeholder="Enter contract address"
 *   label="Target Contract"
 * />
 * ```
 * 
 * Design Token Mapping:
 * - background: --input-bg
 * - border: --input-border
 * - border-radius: --input-border-radius
 * - padding: --input-padding-x, --input-padding-y
 * - font-size: --input-font-size
 */
export const Input: React.FC<InputProps> = ({
  size = 'md',
  fullWidth = false,
  error = false,
  label,
  helperText,
  className = '',
  ...props
}) => {
  const baseStyles = 'block font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 disabled:cursor-not-allowed';
  
  const sizeStyles: Record<string, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-4 py-3 text-base',
  };
  
  const borderStyles = error
    ? 'border-error-500 bg-error-subtle/50'
    : 'border-border bg-surface hover:border-neutral-400';
  
  const widthStyles = fullWidth ? 'w-full' : '';
  
  const radiusStyles = 'rounded-lg';
  
  const inputClasses = [
    baseStyles,
    sizeStyles[size],
    borderStyles,
    widthStyles,
    radiusStyles,
    className,
  ].filter(Boolean).join(' ');
  
  const wrapperClasses = [
    fullWidth ? 'w-full' : '',
  ].filter(Boolean).join(' ');
  
  if (label || helperText) {
    return (
      <div className={wrapperClasses}>
        {label && (
          <label className="block text-sm font-medium text-neutral-400 mb-1">
            {label}
          </label>
        )}
        <input
          type={props.type || 'text'}
          className={inputClasses}
          aria-invalid={error}
          {...props}
        />
        {helperText && (
          <p className={`mt-1 text-xs ${
            error ? 'text-error-500' : 'text-neutral-500'
          }`}>
            {helperText}
          </p>
        )}
      </div>
    );
  }
  
  return (
    <input
      type={props.type || 'text'}
      className={inputClasses}
      aria-invalid={error}
      {...props}
    />
  );
};

Input.displayName = 'Input';