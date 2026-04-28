'use client';

import React from 'react';

interface FormErrorSummaryProps {
  errors: Record<string, string[]>;
  warnings?: Record<string, string[]>;
  fieldLabels?: Record<string, string>;
  className?: string;
  showWarnings?: boolean;
}

const FormErrorSummary: React.FC<FormErrorSummaryProps> = ({
  errors,
  warnings = {},
  fieldLabels = {},
  className = '',
  showWarnings = true
}) => {
  const hasErrors = Object.values(errors).some(fieldErrors => fieldErrors.length > 0);
  const hasWarnings = showWarnings && Object.values(warnings).some(fieldWarnings => fieldWarnings.length > 0);

  if (!hasErrors && !hasWarnings) {
    return null;
  }

  const getFieldLabel = (fieldName: string) => {
    return fieldLabels[fieldName] || fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  };

  const scrollToField = (fieldName: string) => {
    const element = document.querySelector(`[name="${fieldName}"]`) as HTMLElement;
    if (element) {
      element.focus();
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className={`bg-red-500/10 border border-red-500/20 rounded-lg p-4 space-y-3 ${className}`}>
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
          <span className="text-white text-xs font-bold">!</span>
        </div>
        <h3 className="text-sm font-medium text-red-400">
          {hasErrors ? 'Please fix the following errors' : 'Please review the following warnings'}
        </h3>
      </div>

      {hasErrors && (
        <div className="space-y-2">
          {Object.entries(errors).map(([fieldName, fieldErrors]) => 
            fieldErrors.length > 0 && (
              <div key={fieldName} className="space-y-1">
                <button
                  type="button"
                  onClick={() => scrollToField(fieldName)}
                  className="text-xs font-medium text-red-300 hover:text-red-200 transition-colors text-left"
                >
                  {getFieldLabel(fieldName)}
                </button>
                <ul className="ml-4 space-y-1">
                  {fieldErrors.map((error, index) => (
                    <li key={index} className="text-xs text-red-400 flex items-start gap-1">
                      <span className="text-red-500 mt-0.5">•</span>
                      <span>{error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>
      )}

      {hasWarnings && (
        <div className="space-y-2 border-t border-red-500/20 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-yellow-400 text-sm">⚠</span>
            <h4 className="text-xs font-medium text-yellow-400">Warnings</h4>
          </div>
          {Object.entries(warnings).map(([fieldName, fieldWarnings]) => 
            fieldWarnings.length > 0 && (
              <div key={fieldName} className="space-y-1">
                <button
                  type="button"
                  onClick={() => scrollToField(fieldName)}
                  className="text-xs font-medium text-yellow-300 hover:text-yellow-200 transition-colors text-left"
                >
                  {getFieldLabel(fieldName)}
                </button>
                <ul className="ml-4 space-y-1">
                  {fieldWarnings.map((warning, index) => (
                    <li key={index} className="text-xs text-yellow-400 flex items-start gap-1">
                      <span className="text-yellow-500 mt-0.5">•</span>
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default FormErrorSummary;
