'use client';

import React from 'react';
import { FieldValidation } from '../../utils/formValidation/types';

interface FormFieldProps {
  name: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  type?: 'text' | 'number' | 'email' | 'password' | 'textarea';
  className?: string;
  fieldState: FieldValidation;
  onChange: (value: any) => void;
  onBlur: () => void;
  autoComplete?: string;
  rows?: number; // for textarea
  min?: number | string;
  max?: number | string;
  step?: string;
  helpText?: string;
  children?: React.ReactNode;
}

const FormField: React.FC<FormFieldProps> = ({
  name,
  label,
  required = false,
  disabled = false,
  placeholder,
  type = 'text',
  className = '',
  fieldState,
  onChange,
  onBlur,
  autoComplete,
  rows = 3,
  min,
  max,
  step,
  helpText,
  children
}) => {
  const { value, errors, warnings, isValid, isTouched, isValidating } = fieldState;

  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const showError = hasErrors && isTouched;
  const showWarning = hasWarnings && isTouched && !hasErrors;

  const getInputBorderClass = () => {
    const baseClass = "w-full bg-neutral-900 border rounded-lg px-4 py-2 outline-none transition-all font-mono text-sm disabled:opacity-50 disabled:cursor-not-allowed";
    
    if (showError) {
      return `${baseClass} border-red-500/50 focus:ring-2 focus:ring-red-500 focus:border-red-500`;
    }
    if (showWarning) {
      return `${baseClass} border-yellow-500/50 focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500`;
    }
    if (isValid && isTouched) {
      return `${baseClass} border-green-500/50 focus:ring-2 focus:ring-green-500 focus:border-green-500`;
    }
    return `${baseClass} border-neutral-700/50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500`;
  };

  const renderInput = () => {
    if (children) {
      return children;
    }

    const commonProps = {
      name,
      value: value || '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => 
        onChange(type === 'number' ? Number(e.target.value) : e.target.value),
      onBlur,
      disabled,
      placeholder,
      autoComplete,
      className: getInputBorderClass()
    };

    if (type === 'textarea') {
      return (
        <textarea
          {...commonProps}
          rows={rows}
        />
      );
    }

    return (
      <input
        {...commonProps}
        type={type}
        min={min}
        max={max}
        step={step}
      />
    );
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-neutral-400">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
          {isValidating && (
            <span className="ml-2 text-xs text-blue-400">Validating...</span>
          )}
        </label>
      )}

      {renderInput()}

      {/* Validation Messages */}
      <div className="space-y-1">
        {showError && (
          <div className="text-xs text-red-400 space-y-1">
            {errors.map((error, index) => (
              <div key={index} className="flex items-center gap-1">
                <span className="text-red-500">•</span>
                <span>{error}</span>
              </div>
            ))}
          </div>
        )}

        {showWarning && (
          <div className="text-xs text-yellow-400 space-y-1">
            {warnings.map((warning, index) => (
              <div key={index} className="flex items-center gap-1">
                <span className="text-yellow-500">⚠</span>
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}

        {helpText && !showError && (
          <div className="text-xs text-neutral-500">
            {helpText}
          </div>
        )}
      </div>
    </div>
  );
};

export default FormField;
