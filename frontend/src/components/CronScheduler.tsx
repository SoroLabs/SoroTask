"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { parseCron, getNextExecutions, describeCron, CronParseResult } from "../lib/cron";

export type CronPreset = "hourly" | "daily" | "weekly" | "monthly" | "custom";

export type WorldTimezone = {
  id: string;
  label: string;
  zone: string;
  city: string;
};

export const WORLD_ZONES: WorldTimezone[] = [
  { id: "utc", label: "UTC", zone: "UTC", city: "London (Ref)" },
  {
    id: "ny",
    label: "New York",
    zone: "America/New_York",
    city: "New York (EST/EDT)",
  },
  {
    id: "london",
    label: "London",
    zone: "Europe/London",
    city: "London (GMT/BST)",
  },
  {
    id: "sf",
    label: "San Francisco",
    zone: "America/Los_Angeles",
    city: "San Francisco (PST/PDT)",
  },
  { id: "tokyo", label: "Tokyo", zone: "Asia/Tokyo", city: "Tokyo (JST)" },
  {
    id: "sydney",
    label: "Sydney",
    zone: "Australia/Sydney",
    city: "Sydney (AEST/AEDT)",
  },
];

function parseNaturalLanguage(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  // Every N minutes
  const everyNMin = text.match(/every\s+(\d+)\s+minutes?/);
  if (everyNMin) {
    const n = parseInt(everyNMin[1], 10);
    if (n > 0 && n < 60) return `*/${n} * * * *`;
  }

  // Every N hours
  const everyNHour = text.match(/every\s+(\d+)\s+hours?/);
  if (everyNHour) {
    const n = parseInt(everyNHour[1], 10);
    if (n > 0 && n < 24) return `0 */${n} * * *`;
  }

  const dayMap: Record<string, number> = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
  };

  // Parse time like "9:00 AM", "14:30", "9am", "9 pm"
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  let hour = 0;
  let minute = 0;
  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  // Daily / every day
  if (/\b(daily|every\s+day)\b/.test(text)) {
    return `${minute} ${hour} * * *`;
  }

  // Hourly
  if (/\b(hourly|every\s+hour)\b/.test(text)) {
    return `${minute} * * * *`;
  }

  // Weekly on specific day(s)
  const dayMatches = Object.keys(dayMap).filter((d) =>
    new RegExp(`\\b${d}\\b`).test(text),
  );
  if (dayMatches.length > 0) {
    const days = Array.from(new Set(dayMatches.map((d) => dayMap[d]))).sort();
    return `${minute} ${hour} * * ${days.join(",")}`;
  }

  // Monthly on day N
  const monthlyMatch = text.match(/(?:day|on)\s+(\d{1,2})(?:st|nd|rd|th)?/);
  if (monthlyMatch && /\bmonth/.test(text)) {
    const dom = parseInt(monthlyMatch[1], 10);
    if (dom >= 1 && dom <= 31) return `${minute} ${hour} ${dom} * *`;
  }

  return null;
}

export type CronSchedulerProps = {
  initialCron?: string;
  onChange?: (cron: string, humanReadable: string) => void;
};

export function CronScheduler({
  initialCron = "0 9 * * 1", // Default: Every Monday at 9:00 AM
  onChange,
}: CronSchedulerProps) {
  const [cronExpression, setCronExpression] = useState<string>(initialCron);
  const [preset, setPreset] = useState<CronPreset>("weekly");
  const [selectedHour, setSelectedHour] = useState<number>(9);
  const [selectedMinute, setSelectedMinute] = useState<number>(0);
  const [selectedDays, setSelectedDays] = useState<number[]>([1]); // 1 = Monday
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number>(1);
  const [referenceZone, setReferenceZone] = useState<string>("UTC");
  const [naturalInput, setNaturalInput] = useState<string>("");
  const [naturalError, setNaturalError] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);

  const DAYS_OF_WEEK = [
    { label: "Sun", value: 0 },
    { label: "Mon", value: 1 },
    { label: "Tue", value: 2 },
    { label: "Wed", value: 3 },
    { label: "Thu", value: 4 },
    { label: "Fri", value: 5 },
    { label: "Sat", value: 6 },
  ];

  // Parse cron expression into a structured result (with validation)
  const parsed: CronParseResult = useMemo(
    () => parseCron(cronExpression),
    [cronExpression],
  );

  // Human-readable description derived from the parsed cron
  const humanReadable = useMemo(() => {
    if (!parsed.valid) {
      return "Invalid cron expression (must be 5 fields: minute hour dom month dow)";
    }
    return describeCron(parsed);
  }, [parsed]);

  // Sync state to cron expression
  const updateCron = useCallback(
    (newCron: string) => {
      setCronExpression(newCron);
      const result = parseCron(newCron);
      setCronError(result.valid ? null : result.error ?? "Invalid cron expression");
      onChange?.(newCron, result.valid ? describeCron(result) : "");
    },
    [onChange],
  );

  const handlePresetChange = (newPreset: CronPreset) => {
    setPreset(newPreset);
    let nextCron = cronExpression;
    if (newPreset === "hourly") {
      nextCron = "0 * * * *";
    } else if (newPreset === "daily") {
      nextCron = `${selectedMinute} ${selectedHour} * * *`;
    } else if (newPreset === "weekly") {
      const d = selectedDays.length > 0 ? selectedDays.join(",") : "1";
      nextCron = `${selectedMinute} ${selectedHour} * * ${d}`;
    } else if (newPreset === "monthly") {
      nextCron = `${selectedMinute} ${selectedHour} ${selectedDayOfMonth} * *`;
    }
    updateCron(nextCron);
  };

  const handleTimeChange = (hour: number, minute: number) => {
    setSelectedHour(hour);
    setSelectedMinute(minute);
    if (preset === "daily") {
      updateCron(`${minute} ${hour} * * *`);
    } else if (preset === "weekly") {
      const d = selectedDays.length > 0 ? selectedDays.join(",") : "1";
      updateCron(`${minute} ${hour} * * ${d}`);
    } else if (preset === "monthly") {
      updateCron(`${minute} ${hour} ${selectedDayOfMonth} * *`);
    }
  };

  // Natural language -> cron translation
  const handleNaturalLanguage = (value: string) => {
    setNaturalInput(value);
    if (!value.trim()) {
      setNaturalError(null);
      return;
    }
    const result = parseNaturalLanguage(value);
    if (result) {
      setNaturalError(null);
      // Sync visual state to the parsed cron
      syncStateFromCron(result);
      updateCron(result);
    } else {
      setNaturalError(
        "Could not understand that phrase. Try 'Every Monday at 9:00 AM' or 'Daily at 14:30'.",
      );
    }
  };

  // Reflect a cron expression back into the visual controls
  const syncStateFromCron = (cron: string) => {
    const p = parseCron(cron);
    if (!p.valid) return;
    if (p.minute !== null) setSelectedMinute(p.minute);
    if (p.hour !== null) setSelectedHour(p.hour);
    if (p.daysOfWeek.length > 0) setSelectedDays(p.daysOfWeek);
    if (p.dayOfMonth !== null) setSelectedDayOfMonth(p.dayOfMonth);
    if (p.daysOfWeek.length > 0) {
      setPreset("weekly");
    } else if (p.dayOfMonth !== null) {
      setPreset("monthly");
    } else if (p.hour !== null) {
      setPreset("daily");
    } else {
      setPreset("hourly");
    }
  };

  const toggleDayOfWeek = (dayVal: number) => {
    let next: number[];
    if (selectedDays.includes(dayVal)) {
      next = selectedDays.filter((d) => d !== dayVal);
      if (next.length === 0) next = [dayVal]; // keep at least one
    } else {
      next = [...selectedDays, dayVal].sort();
    }
    setSelectedDays(next);
    if (preset === "weekly") {
      updateCron(`${selectedMinute} ${selectedHour} * * ${next.join(",")}`);
    }
  };

  // DST Detection and Offset Helper
  function checkDstActive(
    zone: string,
    date: Date = new Date(),
  ): { isDst: boolean; offsetStr: string } {
    try {
      const jan = new Date(date.getFullYear(), 0, 1);
      const jul = new Date(date.getFullYear(), 6, 1);

      const getOffset = (d: Date) => {
        const utcStr = d.toLocaleString("en-US", { timeZone: "UTC" });
        const tzStr = d.toLocaleString("en-US", { timeZone: zone });
        return (new Date(utcStr).getTime() - new Date(tzStr).getTime()) / 60000;
      };

      const curOffset = getOffset(date);
      const janOffset = getOffset(jan);
      const julOffset = getOffset(jul);
      const stdOffset = Math.max(janOffset, julOffset);
      const isDst = curOffset < stdOffset;

      const hours = Math.floor(Math.abs(curOffset) / 60);
      const mins = Math.abs(curOffset) % 60;
      const sign = curOffset <= 0 ? "+" : "-";
      const offsetStr = `UTC${sign}${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

      return { isDst, offsetStr };
    } catch {
      return { isDst: false, offsetStr: "UTC+00:00" };
    }
  }

  // Next 10 execution dates computed from the actual cron expression
  const nextExecutions = useMemo(() => {
    if (!parsed.valid) return [];
    return getNextExecutions(parsed, new Date(), 10);
  }, [parsed]);

  return (
    <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-slate-100 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold">
            Interactive Time-Window Scheduler
          </h2>
          <p className="text-xs text-slate-400">
            Visual cron resolver with multi-timezone world clock and DST
            auto-correction.
          </p>
        </div>
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300">
          ✨ {parsed.valid ? humanReadable : "Invalid schedule"}
        </div>
      </div>

      {/* Preset Selector */}
      <div className="flex flex-wrap gap-2">
        {(
          ["hourly", "daily", "weekly", "monthly", "custom"] as CronPreset[]
        ).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePresetChange(p)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold capitalize transition ${
              preset === p
                ? "bg-emerald-500 text-slate-950 shadow"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Natural Language Input */}
      <div className="space-y-1.5">
        <label
          htmlFor="cron-natural-input"
          className="text-xs font-semibold text-slate-300 block"
        >
          Describe your schedule in plain English
        </label>
        <input
          id="cron-natural-input"
          type="text"
          value={naturalInput}
          onChange={(e) => handleNaturalLanguage(e.target.value)}
          aria-invalid={naturalError ? true : undefined}
          aria-describedby={naturalError ? "cron-natural-error" : undefined}
          className={`w-full rounded-lg border bg-slate-900 px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 ${
            naturalError ? "border-rose-500" : "border-slate-700"
          }`}
          placeholder="e.g. Every Monday at 9:00 AM, Daily at 14:30, Every 15 minutes"
        />
        {naturalError && (
          <p
            id="cron-natural-error"
            role="alert"
            className="text-[11px] text-rose-400"
          >
            {naturalError}
          </p>
        )}
      </div>

      {/* Visual Configuration Grid */}
      <div className="grid gap-6 sm:grid-cols-2 rounded-xl border border-slate-800 bg-slate-950/60 p-5">
        {/* Time Selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 block">
            Execution Time
          </label>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Hour</span>
              <select
                value={selectedHour}
                onChange={(e) =>
                  handleTimeChange(Number(e.target.value), selectedMinute)
                }
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00 (
                    {h % 12 === 0 ? 12 : h % 12} {h >= 12 ? "PM" : "AM"})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Min</span>
              <select
                value={selectedMinute}
                onChange={(e) =>
                  handleTimeChange(selectedHour, Number(e.target.value))
                }
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 41, 45, 50, 55].map((m) => (
                  <option key={m} value={m}>
                    :{String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Day Selector (for Weekly or Monthly) */}
        {preset === "weekly" && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 block">
              Repeat On Days
            </label>
            <div className="flex gap-1.5">
              {DAYS_OF_WEEK.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDayOfWeek(d.value)}
                  className={`h-8 w-8 rounded-lg text-xs font-bold transition ${
                    selectedDays.includes(d.value)
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {d.label[0]}
                </button>
              ))}
            </div>
          </div>
        )}

        {preset === "monthly" && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 block">
              Day of Month
            </label>
            <select
              value={selectedDayOfMonth}
              onChange={(e) => {
                const day = Number(e.target.value);
                setSelectedDayOfMonth(day);
                updateCron(`${selectedMinute} ${selectedHour} ${day} * *`);
              }}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
            >
              {Array.from({ length: 31 }).map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  Day {i + 1}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Standard Cron Expression Input Field */}
        <div className="sm:col-span-2 space-y-1.5 pt-2 border-t border-slate-900">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300">
              Cron Expression (5-field)
            </label>
            <span className="text-[11px] text-slate-500 font-mono">
              min hour dom month dow
            </span>
          </div>
          <input
            type="text"
            value={cronExpression}
            onChange={(e) => updateCron(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm font-mono text-emerald-400"
            placeholder="* * * * *"
          />
          {cronError && (
            <p
              role="alert"
              className="text-[11px] text-rose-400"
            >
              {cronError}
            </p>
          )}
        </div>
      </div>

      {/* World Clock Visualization */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200">
            World Clock & Timezone Offset Resolver
          </h3>
          <span className="text-xs text-emerald-400 font-mono">
            DST Auto-Correction Enabled
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WORLD_ZONES.map((zone) => {
            const { isDst, offsetStr } = checkDstActive(zone.zone);
            const nowInZone = new Date().toLocaleTimeString("en-US", {
              timeZone: zone.zone,
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            });

            return (
              <div
                key={zone.id}
                className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">
                    {zone.label}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {offsetStr}
                  </span>
                </div>
                <div className="text-lg font-mono font-bold text-slate-100">
                  {nowInZone}
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{zone.city}</span>
                  {isDst ? (
                    <span className="rounded bg-amber-500/20 text-amber-300 px-1.5 py-0.5 text-[10px] font-semibold border border-amber-500/30">
                      DST Active
                    </span>
                  ) : (
                    <span className="rounded bg-slate-800 text-slate-400 px-1.5 py-0.5 text-[10px]">
                      Standard
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming Scheduled Executions */}
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-300">
            Upcoming Execution Windows (Auto-Calculated)
          </span>
          <span className="text-slate-500 text-[11px]">
            Next 10 runs · {referenceZone}
          </span>
        </div>
        <div className="divide-y divide-slate-800/60 font-mono">
          {nextExecutions.map((execDate, idx) => (
            <div
              key={idx}
              className="py-2 first:pt-0 last:pb-0 flex items-center justify-between"
            >
              <span className="text-slate-400">
                Run #{idx + 1}: {execDate.toDateString()}
              </span>
              <span className="text-emerald-400">
                {execDate.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                })}{" "}
                UTC
              </span>
            </div>
          ))}
          {nextExecutions.length === 0 && (
            <div className="py-2 text-slate-500">
              No upcoming executions — fix the cron expression above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
