"use client";

import React, { useState, useEffect, useMemo } from "react";

export type SchedulePreset =
  "every_15_min" | "hourly" | "daily" | "weekly" | "custom_seconds" | "cron";

export interface CronScheduleBuilderProps {
  initialSeconds?: number;
  initialCron?: string;
  initialTimezone?: string;
  onScheduleChange?: (
    intervalSeconds: number,
    cronExpression?: string,
    timezone?: string,
  ) => void;
  className?: string;
}

const PRESET_INTERVALS: Record<
  SchedulePreset,
  { label: string; seconds: number; cron: string }
> = {
  every_15_min: {
    label: "Every 15 Minutes",
    seconds: 900,
    cron: "*/15 * * * *",
  },
  hourly: { label: "Hourly", seconds: 3600, cron: "0 * * * *" },
  daily: { label: "Daily (Midnight)", seconds: 86400, cron: "0 0 * * *" },
  weekly: { label: "Weekly (Sunday)", seconds: 604800, cron: "0 0 * * 0" },
  custom_seconds: {
    label: "Custom Seconds",
    seconds: 300,
    cron: "*/5 * * * *",
  },
  cron: { label: "Advanced Cron Expression", seconds: 3600, cron: "0 * * * *" },
};

export const formatSecondsToReadable = (sec: number): string => {
  if (sec <= 0) return "0 seconds";
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.join(" ");
};

export const CronScheduleBuilder: React.FC<CronScheduleBuilderProps> = ({
  initialSeconds = 3600,
  initialCron = "0 * * * *",
  initialTimezone = "UTC",
  onScheduleChange,
  className = "",
}) => {
  const [preset, setPreset] = useState<SchedulePreset>("hourly");
  const [intervalSeconds, setIntervalSeconds] =
    useState<number>(initialSeconds);
  const [cronExpression, setCronExpression] = useState<string>(initialCron);
  const [timezone, setTimezone] = useState<string>(initialTimezone);

  // Synchronize upstream
  useEffect(() => {
    if (onScheduleChange) {
      onScheduleChange(intervalSeconds, cronExpression, timezone);
    }
  }, [intervalSeconds, cronExpression, timezone, onScheduleChange]);

  const handlePresetSelect = (p: SchedulePreset) => {
    setPreset(p);
    if (p !== "custom_seconds" && p !== "cron") {
      const presetData = PRESET_INTERVALS[p];
      setIntervalSeconds(presetData.seconds);
      setCronExpression(presetData.cron);
    }
  };

  // Preview next 5 mock runs based on interval seconds
  const nextRuns = useMemo(() => {
    const runs: string[] = [];
    const now = Date.now();
    const intervalMs = Math.max(10, intervalSeconds) * 1000;
    for (let i = 1; i <= 5; i++) {
      const date = new Date(now + intervalMs * i);
      runs.push(
        date.toISOString().replace("T", " ").substring(0, 19) +
          ` (${timezone})`,
      );
    }
    return runs;
  }, [intervalSeconds, timezone]);

  return (
    <div
      className={`rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 text-neutral-200 shadow-md ${className}`}
    >
      <div className="mb-4 flex items-center justify-between border-b border-neutral-800 pb-3">
        <div>
          <h3 className="text-base font-semibold text-white">
            Recurring Schedule Builder
          </h3>
          <p className="text-xs text-neutral-400">
            Configure autonomous task execution intervals or cron schedules.
          </p>
        </div>
        <span className="rounded-md bg-emerald-950/60 px-2.5 py-1 text-xs font-mono font-medium text-emerald-400 border border-emerald-800/50">
          {formatSecondsToReadable(intervalSeconds)}
        </span>
      </div>

      {/* Preset Selector */}
      <div className="mb-4">
        <label
          htmlFor="cron-frequency-preset"
          className="mb-1.5 block text-xs font-medium text-neutral-300"
        >
          Frequency Preset
        </label>
        <select
          id="cron-frequency-preset"
          value={preset}
          onChange={(e) => handlePresetSelect(e.target.value as SchedulePreset)}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none"
        >
          {Object.entries(PRESET_INTERVALS).map(([key, val]) => (
            <option key={key} value={key}>
              {val.label}
            </option>
          ))}
        </select>
      </div>

      {/* Custom Seconds Mode */}
      {preset === "custom_seconds" && (
        <div className="mb-4">
          <label
            htmlFor="cron-custom-seconds"
            className="mb-1.5 block text-xs font-medium text-neutral-300"
          >
            Interval (in seconds)
          </label>
          <input
            id="cron-custom-seconds"
            type="number"
            min="10"
            value={intervalSeconds}
            onChange={(e) => {
              const val = Math.max(1, parseInt(e.target.value || "1", 10));
              setIntervalSeconds(val);
            }}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-2 text-sm text-neutral-100 font-mono focus:border-indigo-500 focus:outline-none"
          />
        </div>
      )}

      {/* Advanced Cron Mode */}
      {preset === "cron" && (
        <div className="mb-4 space-y-3">
          <div>
            <label
              htmlFor="cron-expression"
              className="mb-1.5 block text-xs font-medium text-neutral-300"
            >
              Standard Cron Expression (5 Fields)
            </label>
            <input
              id="cron-expression"
              type="text"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="* * * * *"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-2 text-sm text-neutral-100 font-mono focus:border-indigo-500 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-neutral-500 font-mono">
              minute · hour · day-of-month · month · day-of-week
            </p>
          </div>
          <div>
            <label
              htmlFor="cron-interval-seconds"
              className="mb-1.5 block text-xs font-medium text-neutral-300"
            >
              Equivalent Interval (Seconds)
            </label>
            <input
              id="cron-interval-seconds"
              type="number"
              min="10"
              value={intervalSeconds}
              onChange={(e) =>
                setIntervalSeconds(
                  Math.max(1, parseInt(e.target.value || "1", 10)),
                )
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-2 text-sm text-neutral-100 font-mono focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Timezone Selection */}
      <div className="mb-4">
        <label
          htmlFor="cron-timezone"
          className="mb-1.5 block text-xs font-medium text-neutral-300"
        >
          Execution Timezone
        </label>
        <select
          id="cron-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none"
        >
          <option value="UTC">UTC (Coordinated Universal Time)</option>
          <option value="America/New_York">America/New_York (EST/EDT)</option>
          <option value="Europe/London">Europe/London (GMT/BST)</option>
          <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
          <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
        </select>
      </div>

      {/* Next Execution Preview */}
      <div className="mt-4 rounded-lg border border-neutral-800/90 bg-neutral-950/50 p-3.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Next 5 Estimated Executions
        </span>
        <ul className="mt-2 space-y-1 text-xs font-mono text-neutral-300">
          {nextRuns.map((run, idx) => (
            <li key={idx} className="flex items-center space-x-2">
              <span className="text-neutral-500">#{idx + 1}</span>
              <span>{run}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default CronScheduleBuilder;
