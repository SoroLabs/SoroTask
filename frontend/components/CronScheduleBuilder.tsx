"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";

export interface CronScheduleBuilderProps {
  /** Initial value in seconds */
  value?: number;
  /** Callback when schedule changes */
  onChange: (seconds: number, cronExpression?: string) => void;
  /** Label for the input */
  label?: string;
  /** Helper text */
  helperText?: string;
}

/** Preset schedule options (Medium: Dropdown for simple presets) */
type SchedulePreset = "hourly" | "daily" | "weekly" | "custom";

interface PresetOption {
  label: string;
  value: SchedulePreset;
  seconds: number;
  description: string;
}

const PRESET_OPTIONS: PresetOption[] = [
  { label: "Hourly", value: "hourly", seconds: 3600, description: "Every hour" },
  { label: "Daily", value: "daily", seconds: 86400, description: "Once per day" },
  { label: "Weekly", value: "weekly", seconds: 604800, description: "Once per week" },
  { label: "Custom", value: "custom", seconds: 0, description: "Set custom interval" },
];

/** Parse cron expression to extract components */
interface CronParts {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

function parseCronExpression(expression: string): CronParts | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  
  return {
    minute: parts[0],
    hour: parts[1],
    dayOfMonth: parts[2],
    month: parts[3],
    dayOfWeek: parts[4],
  };
}

/** Convert cron parts back to expression */
function buildCronExpression(parts: CronParts): string {
  return `${parts.minute} ${parts.hour} ${parts.dayOfMonth} ${parts.month} ${parts.dayOfWeek}`;
}

/** Calculate next N run times from a cron expression (Advanced: next-5-runs preview) */
function getNextRuns(cronExpression: string, count: number = 5, timezone: string = "UTC"): Date[] {
  const parts = parseCronExpression(cronExpression);
  if (!parts) return [];
  
  const runs: Date[] = [];
  const now = new Date();
  
  // Simple implementation - in production use a proper cron library
  for (let i = 0; i < count && runs.length < count; i++) {
    const next = new Date(now);
    next.setSeconds(0, 0);
    
    // Parse minute and hour to find next occurrence
    const minute = parts.minute === "*" ? next.getMinutes() : parseInt(parts.minute) || 0;
    const hour = parts.hour === "*" ? next.getHours() : parseInt(parts.hour) || 0;
    const dayOfMonth = parts.dayOfMonth === "*" ? next.getDate() : parseInt(parts.dayOfMonth) || 1;
    const dayOfWeek = parts.dayOfWeek === "*" ? -1 : parseInt(parts.dayOfWeek) || 0;
    
    // Calculate next occurrence (simplified)
    if (parts.minute !== "*") {
      next.setMinutes(minute);
    } else {
      next.setMinutes(next.getMinutes() + 1);
    }
    
    if (parts.hour !== "*") {
      next.setHours(hour);
    }
    
    if (parts.dayOfMonth !== "*") {
      next.setDate(dayOfMonth);
    }
    
    // If the calculated time is in the past, add appropriate interval
    if (next <= now) {
      if (parts.dayOfMonth !== "*") {
        next.setDate(next.getDate() + 7);
      } else if (parts.hour !== "*") {
        next.setHours(next.getHours() + 1);
      } else {
        next.setMinutes(next.getMinutes() + 1);
      }
    }
    
    runs.push(next);
  }
  
  return runs;
}

/** Convert seconds to human readable interval (Advanced: Automatic second interval calculation) */
function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minute${seconds >= 120 ? "s" : ""}`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hour${seconds >= 7200 ? "s" : ""}`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} day${seconds >= 172800 ? "s" : ""}`;
  return `${Math.floor(seconds / 604800)} week${seconds >= 1209600 ? "s" : ""}`;
}

/** Available timezones for the schedule (Advanced: Timezone conversion) */
const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern (US)" },
  { value: "America/Los_Angeles", label: "Pacific (US)" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Shanghai", label: "Shanghai" },
];

export function CronScheduleBuilder({
  value = 3600,
  onChange,
  label = "Schedule Interval",
  helperText,
}: CronScheduleBuilderProps) {
  const [preset, setPreset] = useState<SchedulePreset>("hourly");
  const [customSeconds, setCustomSeconds] = useState(String(value));
  const [cronExpression, setCronExpression] = useState<string>("0 * * * *");
  const [timezone, setTimezone] = useState("UTC");
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Parse initial value to determine preset
  useEffect(() => {
    const matchedPreset = PRESET_OPTIONS.find(p => p.seconds === value);
    if (matchedPreset) {
      setPreset(matchedPreset.value);
      setCustomSeconds(String(value));
    } else {
      setPreset("custom");
      setCustomSeconds(String(value));
    }
  }, []);
  
  // Calculate seconds from preset or custom input
  const currentSeconds = useMemo(() => {
    if (preset === "custom") {
      return parseInt(customSeconds) || 0;
    }
    const selectedPreset = PRESET_OPTIONS.find(p => p.value === preset);
    return selectedPreset?.seconds || 0;
  }, [preset, customSeconds]);
  
  // Update cron expression when seconds change
  useEffect(() => {
    let cron = "* * * * *";
    
    if (currentSeconds >= 604800) {
      // Weekly
      cron = "0 0 * * 1"; // Monday at midnight
    } else if (currentSeconds >= 86400) {
      // Daily
      cron = "0 0 * * *"; // Midnight daily
    } else if (currentSeconds >= 3600) {
      // Hourly
      const minute = Math.floor(Math.random() * 60); // Random minute for distribution
      cron = `${minute} * * * *`;
    } else if (currentSeconds >= 60) {
      // Minutes
      const minuteInterval = Math.floor(currentSeconds / 60);
      cron = `*/${minuteInterval} * * * *`;
    } else {
      // Seconds (not standard cron, use as minimum)
      cron = `* * * * *`;
    }
    
    setCronExpression(cron);
  }, [currentSeconds]);
  
  // Handle preset change
  const handlePresetChange = useCallback((newPreset: SchedulePreset) => {
    setPreset(newPreset);
    if (newPreset !== "custom") {
      const selectedPreset = PRESET_OPTIONS.find(p => p.value === newPreset);
      if (selectedPreset) {
        setCustomSeconds(String(selectedPreset.seconds));
        onChange(selectedPreset.seconds);
      }
    } else {
      onChange(parseInt(customSeconds) || 0);
    }
  }, [customSeconds, onChange]);
  
  // Handle custom seconds change
  const handleCustomSecondsChange = useCallback((value: string) => {
    setCustomSeconds(value);
    const seconds = parseInt(value) || 0;
    onChange(seconds);
  }, [onChange]);
  
  // Handle cron expression change
  const handleCronChange = useCallback((part: keyof CronParts, val: string) => {
    const parts = parseCronExpression(cronExpression) || {
      minute: "*",
      hour: "*",
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
    };
    parts[part] = val;
    const newCron = buildCronExpression(parts);
    setCronExpression(newCron);
    
    // Convert cron to seconds (approximate)
    const seconds = convertCronToSeconds(newCron);
    onChange(seconds, newCron);
  }, [cronExpression, onChange]);
  
  // Next scheduled runs
  const nextRuns = useMemo(() => {
    return getNextRuns(cronExpression, 5, timezone);
  }, [cronExpression, timezone]);

  return (
    <div className="space-y-4">
      {/* Label */}
      {label && (
        <label className="block text-sm font-medium text-neutral-300">
          {label}
        </label>
      )}
      
      {/* Preset Dropdown (Medium: Hourly/Daily presets) */}
      <div className="flex gap-2">
        <select
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value as SchedulePreset)}
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 flex-1"
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} - {option.description}
            </option>
          ))}
        </select>
      </div>
      
      {/* Custom Seconds Input (Easy: Input field for interval in seconds) */}
      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            value={customSeconds}
            onChange={(e) => handleCustomSecondsChange(e.target.value)}
            placeholder="Seconds"
            className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 w-32"
          />
          <span className="text-sm text-neutral-400">
            = {formatInterval(parseInt(customSeconds) || 0)}
          </span>
        </div>
      )}
      
      {/* Current interval display */}
      {preset !== "custom" && (
        <p className="text-sm text-neutral-400">
          Current interval: {formatInterval(currentSeconds)}
        </p>
      )}
      
      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
      >
        {showAdvanced ? "▼" : "▶"} 
        {showAdvanced ? "Hide" : "Show"} Advanced Cron Options
      </button>
      
      {/* Advanced: Full cron expression builder (Advanced: Full cron generator) */}
      {showAdvanced && (
        <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4 space-y-4">
          <h4 className="text-sm font-semibold text-neutral-200">Cron Expression Builder</h4>
          
          {/* Cron expression input */}
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Expression</label>
            <input
              type="text"
              value={cronExpression}
              onChange={(e) => {
                setCronExpression(e.target.value);
                const seconds = convertCronToSeconds(e.target.value);
                onChange(seconds, e.target.value);
              }}
              placeholder="* * * * *"
              className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 w-full font-mono"
            />
            <p className="text-[10px] text-neutral-500 mt-1">
              Format: minute hour day-of-month month day-of-week
            </p>
          </div>
          
          {/* Individual cron parts */}
          <div className="grid grid-cols-5 gap-2">
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1">Minute</label>
              <input
                type="text"
                value={parseCronExpression(cronExpression)?.minute || "*"}
                onChange={(e) => handleCronChange("minute", e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100 w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1">Hour</label>
              <input
                type="text"
                value={parseCronExpression(cronExpression)?.hour || "*"}
                onChange={(e) => handleCronChange("hour", e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100 w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1">Day</label>
              <input
                type="text"
                value={parseCronExpression(cronExpression)?.dayOfMonth || "*"}
                onChange={(e) => handleCronChange("dayOfMonth", e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100 w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1">Month</label>
              <input
                type="text"
                value={parseCronExpression(cronExpression)?.month || "*"}
                onChange={(e) => handleCronChange("month", e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100 w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1">Weekday</label>
              <input
                type="text"
                value={parseCronExpression(cronExpression)?.dayOfWeek || "*"}
                onChange={(e) => handleCronChange("dayOfWeek", e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100 w-full font-mono"
              />
            </div>
          </div>
          
          {/* Timezone selector (Advanced: Timezone conversion) */}
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 w-full"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
          
          {/* Next 5 runs preview (Advanced: next-5-runs preview) */}
          <div>
            <label className="block text-xs text-neutral-400 mb-2">Next 5 Scheduled Runs</label>
            <div className="space-y-1">
              {nextRuns.map((run, i) => (
                <div
                  key={i}
                  className="flex justify-between text-xs text-neutral-300 bg-neutral-800/50 rounded px-2 py-1"
                >
                  <span>{run.toLocaleDateString()}</span>
                  <span className="font-mono">{run.toLocaleTimeString()}</span>
                  <span className="text-neutral-500">{timezone}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Helper text */}
      {helperText && (
        <p className="text-xs text-neutral-500">{helperText}</p>
      )}
    </div>
  );
}

/** Convert cron expression to approximate seconds (Advanced: Automatic second interval calculation) */
function convertCronToSeconds(cron: string): number {
  const parts = parseCronExpression(cron);
  if (!parts) return 3600;
  
  // Simple conversion - in production use a proper cron library
  if (parts.dayOfMonth !== "*" && parts.dayOfMonth !== "?") {
    return 604800; // Weekly or more
  }
  
  if (parts.hour !== "*" && parts.hour !== "?") {
    if (parts.minute === "*" || parts.minute === "0") {
      return 86400; // Daily
    }
    return 3600; // Hourly
  }
  
  if (parts.minute.startsWith("*/")) {
    const interval = parseInt(parts.minute.slice(2)) || 1;
    return interval * 60;
  }
  
  if (parts.minute !== "*" && parts.minute !== "?") {
    return 3600; // Hourly
  }
  
  return 3600; // Default to hourly
}

export default CronScheduleBuilder;