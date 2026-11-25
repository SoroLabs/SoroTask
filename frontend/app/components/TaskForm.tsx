"use client";

import useFormValidation from "../utils/formValidation/useFormValidation";
import { taskFormConfig, fieldLabels } from "../utils/formValidation/formConfigs";
import FormField from "./form/FormField";
import FormErrorSummary from "./form/FormErrorSummary";
import { Button } from "./Button";

export interface TaskFormValues {
  targetAddress: string;
  functionName: string;
  intervalSeconds: number;
  gasBalance: number;
}

interface TaskFormProps {
  onSubmit?: (values: TaskFormValues) => void;
  loading?: boolean;
}

export function TaskForm({ onSubmit, loading = false }: TaskFormProps) {
  const {
    handleChange,
    handleBlur,
    handleSubmit,
    getFieldState,
    hasErrors,
    formState,
  } = useFormValidation({
    ...taskFormConfig,
    onSubmit: async (values) => {
      onSubmit?.(values as TaskFormValues);
    },
  });

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 space-y-4 shadow-xl"
    >
      {hasErrors() && (
        <FormErrorSummary
          errors={formState.errors}
          fieldLabels={fieldLabels}
        />
      )}

      <FormField
        name="targetAddress"
        label="Target Contract Address"
        required
        placeholder="C..."
        fieldState={getFieldState("targetAddress")}
        onChange={(value) => handleChange("targetAddress", value)}
        onBlur={() => handleBlur("targetAddress")}
        helpText="Enter the Stellar contract address starting with 'C'"
      />

      <FormField
        name="functionName"
        label="Function Name"
        required
        placeholder="harvest_yield"
        fieldState={getFieldState("functionName")}
        onChange={(value) => handleChange("functionName", value)}
        onBlur={() => handleBlur("functionName")}
        helpText="Lowercase letters, numbers, and underscores only"
      />

      <div className="grid grid-cols-2 gap-4">
        <FormField
          name="intervalSeconds"
          label="Interval (seconds)"
          required
          placeholder="3600"
          type="number"
          min={60}
          fieldState={getFieldState("intervalSeconds")}
          onChange={(value) => handleChange("intervalSeconds", value)}
          onBlur={() => handleBlur("intervalSeconds")}
          helpText="Minimum 60 seconds"
        />

        <FormField
          name="gasBalance"
          label="Gas Balance (XLM)"
          required
          placeholder="10"
          type="number"
          min={0.1}
          max={10000}
          step="0.1"
          fieldState={getFieldState("gasBalance")}
          onChange={(value) => handleChange("gasBalance", value)}
          onBlur={() => handleBlur("gasBalance")}
          helpText="Between 0.1 and 10000 XLM"
        />
      </div>

      <Button type="submit" fullWidth loading={loading} className="mt-2 py-3">
        Register Task
      </Button>
    </form>
  );
}
