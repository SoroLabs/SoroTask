'use client';

import React from 'react';

interface FormSubmitButtonProps {
  children: React.ReactNode;
  isSubmitting?: boolean;
  isDisabled?: boolean;
  isValid?: boolean;
  isDirty?: boolean;
  className?: string;
  loadingText?: string;
  disabledText?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  onClick?: () => void;
  retryCount?: number;
  maxRetries?: number;
  submissionError?: string;
}

const FormSubmitButton: React.FC<FormSubmitButtonProps> = ({
  children,
  isSubmitting = false,
  isDisabled = false,
  isValid = true,
  isDirty = false,
  className = '',
  loadingText = 'Submitting...',
  disabledText = 'Please fill out the form',
  variant = 'primary',
  size = 'md',
  type = 'submit',
  onClick,
  retryCount = 0,
  maxRetries = 3,
  submissionError
}) => {
  const getButtonClass = () => {
    const baseClass = "font-medium rounded-lg transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2";
    
    const sizeClasses = {
      sm: "px-3 py-1.5 text-sm",
      md: "px-4 py-2 text-sm",
      lg: "px-6 py-3 text-base"
    };

    const variantClasses = {
      primary: "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20",
      secondary: "bg-neutral-700 hover:bg-neutral-600 text-white",
      danger: "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
    };

    return `${baseClass} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`;
  };

  const isButtonDisabled = isDisabled || isSubmitting || (!isValid && isDirty);

  const getButtonText = () => {
    if (isSubmitting) {
      if (retryCount > 0) {
        return `Retrying... (${retryCount}/${maxRetries})`;
      }
      return loadingText;
    }
    if (isDisabled && disabledText) return disabledText;
    if (submissionError && retryCount < maxRetries) {
      return `Retry (${retryCount + 1}/${maxRetries})`;
    }
    return children;
  };

  const renderLoadingSpinner = () => {
    if (!isSubmitting) return null;
    
    return (
      <svg 
        className="animate-spin h-4 w-4" 
        xmlns="http://www.w3.org/2000/svg" 
        fill="none" 
        viewBox="0 0 24 24"
      >
        <circle 
          className="opacity-25" 
          cx="12" 
          cy="12" 
          r="10" 
          stroke="currentColor" 
          strokeWidth="4"
        />
        <path 
          className="opacity-75" 
          fill="currentColor" 
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    );
  };

  const renderSuccessIcon = () => {
    if (!isValid && isDirty) return null;
    
    return (
      <svg 
        className="h-4 w-4 text-green-400" 
        xmlns="http://www.w3.org/2000/svg" 
        fill="none" 
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2} 
          d="M5 13l4 4L19 7" 
        />
      </svg>
    );
  };

  const renderIcon = () => {
    if (isSubmitting) return renderLoadingSpinner();
    if (isValid && isDirty) return renderSuccessIcon();
    return null;
  };

  return (
    <button
      type={type}
      className={getButtonClass()}
      disabled={isButtonDisabled}
      onClick={onClick}
    >
      {renderIcon()}
      <span>{getButtonText()}</span>
    </button>
  );
};

export default FormSubmitButton;
