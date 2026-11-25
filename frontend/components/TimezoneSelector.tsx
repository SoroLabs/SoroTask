"use client";

import React, { useMemo } from "react";
import {
  getAvailableTimezones,
  getTimezoneOffset,
  formatDualTimestamp,
  getDSTWarning,
  getUserTimezone,
} from "@/lib/timezoneUtils";

export interface TimezoneSelectorProps {
  selectedTimezone: string;
  onTimezoneChange: (timezone: string) => void;
  previewDate?: Date;
  label?: string;
  showDualTimestamp?: boolean;
}

export function TimezoneSelector({
  selectedTimezone,
  onTimezoneChange,
  previewDate = new Date(),
  label = "Task Schedule Timezone",
  showDualTimestamp = true,
}: TimezoneSelectorProps) {
  const timezones = useMemo(() => getAvailableTimezones(), []);

  const dualTimestamp = useMemo(() => {
    return formatDualTimestamp(previewDate, selectedTimezone);
  }, [previewDate, selectedTimezone]);

  const dstInfo = useMemo(() => {
    return getDSTWarning(previewDate, selectedTimezone);
  }, [previewDate, selectedTimezone]);

  return (
    <div className="space-y-3 rounded-xl border border-neutral-700/60 bg-neutral-900/40 p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <label className="text-xs font-medium text-neutral-300 uppercase tracking-wider">
          {label}
        </label>
        <button
          type="button"
          onClick={() => onTimezoneChange(getUserTimezone())}
          className="text-[11px] text-blue-400 hover:text-blue-300 underline self-start sm:self-auto"
        >
          Use Device Timezone ({getUserTimezone()})
        </button>
      </div>

      <select
        value={selectedTimezone}
        onChange={(e) => onTimezoneChange(e.target.value)}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
      >
        {timezones.map((tz) => {
          const offset = getTimezoneOffset(tz, previewDate);
          return (
            <option key={tz} value={tz}>
              {tz} ({offset})
            </option>
          );
        })}
      </select>

      {showDualTimestamp && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-3 space-y-1.5 font-mono text-xs">
          <div className="flex items-center justify-between text-neutral-400">
            <span>Local Time:</span>
            <span className="text-neutral-200">{dualTimestamp.local}</span>
          </div>
          <div className="flex items-center justify-between text-neutral-400 border-t border-neutral-850 pt-1.5">
            <span>UTC Ledger Time:</span>
            <span className="text-emerald-400 font-semibold">{dualTimestamp.utc}</span>
          </div>
        </div>
      )}

      {dstInfo.isDST && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200 flex items-start gap-2">
          <span className="shrink-0">☀️</span>
          <p>{dstInfo.warning}</p>
        </div>
      )}
    </div>
  );
}

export default TimezoneSelector;
