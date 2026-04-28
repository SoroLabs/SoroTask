'use client';

import React from 'react';
import useFormValidation from '../utils/formValidation/useFormValidation';
import { taskCreationFormConfig, fieldLabels } from '../utils/formValidation/formConfigs';
import FormField from './form/FormField';
import FormSubmitButton from './form/FormSubmitButton';
import FormErrorSummary from './form/FormErrorSummary';
import DateInput from './DateInput';

const TaskCreationForm: React.FC = () => {
  const {
    formState,
    handleChange,
    handleBlur,
    handleSubmit,
    resetForm,
    getFieldState,
    hasErrors
  } = useFormValidation(taskCreationFormConfig);

  const handleDateChange = (value: string, parsedDate?: Date) => {
    handleChange('dueDate', value);
  };

  const handleFormSubmit = async (event: React.FormEvent) => {
    try {
      await handleSubmit(event);
      // Success handling could go here (show toast, redirect, etc.)
      console.log('Task created successfully!');
    } catch (error) {
      console.error('Failed to create task:', error);
      // Error handling could go here (show error message)
    }
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6">
      {/* Error Summary */}
      {hasErrors() && (
        <FormErrorSummary
          errors={formState.errors}
          fieldLabels={fieldLabels}
          className="mb-6"
        />
      )}

      {/* Contract Address Field */}
      <FormField
        name="contractAddress"
        label="Target Contract Address"
        required={true}
        placeholder="C..."
        fieldState={getFieldState('contractAddress')}
        onChange={(value) => handleChange('contractAddress', value)}
        onBlur={() => handleBlur('contractAddress')}
        autoComplete="off"
        helpText="Enter the Stellar contract address starting with 'C'"
      />

      {/* Function Name Field */}
      <FormField
        name="functionName"
        label="Function Name"
        required={true}
        placeholder="harvest_yield"
        fieldState={getFieldState('functionName')}
        onChange={(value) => handleChange('functionName', value)}
        onBlur={() => handleBlur('functionName')}
        autoComplete="off"
        helpText="Function name must contain only lowercase letters, numbers, and underscores"
      />

      {/* Interval and Gas Balance Fields */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          name="interval"
          label="Interval (seconds)"
          required={true}
          placeholder="3600"
          type="number"
          min="60"
          fieldState={getFieldState('interval')}
          onChange={(value) => handleChange('interval', value)}
          onBlur={() => handleBlur('interval')}
          helpText="Minimum 60 seconds"
        />

        <FormField
          name="gasBalance"
          label="Gas Balance (XLM)"
          required={true}
          placeholder="10"
          type="number"
          min="0.1"
          max="10000"
          step="0.1"
          fieldState={getFieldState('gasBalance')}
          onChange={(value) => handleChange('gasBalance', value)}
          onBlur={() => handleBlur('gasBalance')}
          helpText="Between 0.1 and 10000 XLM"
        />
      </div>

      {/* Due Date Field */}
      <DateInput
        value={formState.values.dueDate || ''}
        onChange={handleDateChange}
        label="Due Date"
        required={false}
        className="mt-4"
      />

      {/* Form Actions */}
      <div className="flex gap-4 pt-4">
        <FormSubmitButton
          type="submit"
          isSubmitting={formState.isSubmitting}
          isValid={!hasErrors()}
          isDirty={formState.isDirty}
          loadingText="Creating Task..."
          disabledText="Please fill out required fields"
        >
          Register Task
        </FormSubmitButton>

        <button
          type="button"
          onClick={resetForm}
          className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-neutral-300 transition-colors"
        >
          Reset Form
        </button>
      </div>

      {/* Form Status */}
      {formState.isSubmitted && !hasErrors() && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs">✓</span>
            </div>
            <p className="text-sm text-green-400">Task created successfully!</p>
          </div>
        </div>
      )}
    </form>
  );
};

export default TaskCreationForm;
