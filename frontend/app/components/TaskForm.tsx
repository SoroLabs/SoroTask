"use client";

import { useState, FormEvent } from "react";
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
  const [values, setValues] = useState<TaskFormValues>({
    targetAddress: "",
    functionName: "",
    intervalSeconds: 3600,
    gasBalance: 10,
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit?.(values);
  }

  const inputClass =
    "w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 space-y-4 shadow-xl"
    >
      <div>
        <label className="block text-sm font-medium text-neutral-400 mb-1">
          Target Contract Address
        </label>
        <input
          type="text"
          placeholder="C..."
          value={values.targetAddress}
          onChange={(e) =>
            setValues((v) => ({ ...v, targetAddress: e.target.value }))
          }
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-400 mb-1">
          Function Name
        </label>
        <input
          type="text"
          placeholder="harvest_yield"
          value={values.functionName}
          onChange={(e) =>
            setValues((v) => ({ ...v, functionName: e.target.value }))
          }
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-400 mb-1">
            Interval (seconds)
          </label>
          <input
            type="number"
            placeholder="3600"
            value={values.intervalSeconds}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                intervalSeconds: Number(e.target.value),
              }))
            }
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-400 mb-1">
            Gas Balance (XLM)
          </label>
          <input
            type="number"
            placeholder="10"
            value={values.gasBalance}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                gasBalance: Number(e.target.value),
              }))
            }
            className={inputClass}
          />
        </div>
      </div>

      <Button type="submit" fullWidth loading={loading} className="mt-2 py-3">
        Register Task
      </Button>
    </form>
  );
}
