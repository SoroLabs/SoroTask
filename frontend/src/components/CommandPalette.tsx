"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
import {
  CommandItem,
  fuzzySearchCommands,
  getSavedFilters,
  saveCustomFilter,
  deleteCustomFilter,
  SavedFilter,
} from "../lib/search/fuzzySearch";

export interface CommandPaletteProps {
  commands?: CommandItem[];
  isOpen?: boolean;
  onClose?: () => void;
}

export function CommandPalette({
  commands = [],
  isOpen: controlledIsOpen,
  onClose,
}: CommandPaletteProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [filterName, setFilterName] = useState("");
  const [isSavingFilter, setIsSavingFilter] = useState(false);
  const [openLatencyMs, setOpenLatencyMs] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const isPaletteOpen =
    controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

  const filtered = fuzzySearchCommands(commands, query);

  useEffect(() => {
    setSavedFilters(getSavedFilters());
  }, [isPaletteOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const start = performance.now();
        startTransition(() => {
          if (controlledIsOpen !== undefined) {
            onClose ? onClose() : null;
          } else {
            setInternalIsOpen((prev) => !prev);
          }
        });
        const latency = performance.now() - start;
        setOpenLatencyMs(latency);
      } else if (e.key === "Escape") {
        if (controlledIsOpen !== undefined) {
          onClose?.();
        } else {
          setInternalIsOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controlledIsOpen, onClose]);

  useEffect(() => {
    if (isPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setSelectedIndex(0);
      setIsSavingFilter(false);
    }
  }, [isPaletteOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length > 0 ? (prev + 1) % filtered.length : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length > 0
          ? (prev - 1 + filtered.length) % filtered.length
          : 0,
      );
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].action();
      if (controlledIsOpen !== undefined) {
        onClose?.();
      } else {
        setInternalIsOpen(false);
      }
    }
  };

  const handleSaveFilter = () => {
    if (!filterName.trim() || !query.trim()) return;
    const created = saveCustomFilter(filterName.trim(), query.trim());
    setSavedFilters((prev) => [...prev, created]);
    setFilterName("");
    setIsSavingFilter(false);
  };

  const handleDeleteFilter = (id: string) => {
    deleteCustomFilter(id);
    setSavedFilters((prev) => prev.filter((f) => f.id !== id));
  };

  if (!isPaletteOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm pt-20 p-4"
      data-testid="command-palette"
      onClick={() =>
        controlledIsOpen !== undefined ? onClose?.() : setInternalIsOpen(false)
      }
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search header */}
        <div className="flex items-center border-b border-slate-800 px-4 py-3.5 gap-3">
          <svg
            className="h-5 w-5 text-indigo-400 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search tasks, contracts, boolean queries (e.g., status:active AND gas:<10)..."
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            autoFocus
          />
          {openLatencyMs !== null && (
            <span
              className="text-[10px] text-emerald-400 font-mono shrink-0"
              title="Command palette open latency"
            >
              {openLatencyMs.toFixed(1)}ms
            </span>
          )}
          <kbd className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 font-mono border border-slate-700 shrink-0">
            ESC
          </kbd>
        </div>

        {/* Saved Filters Bar */}
        {savedFilters.length > 0 && (
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-800/80 bg-slate-950/40 overflow-x-auto text-xs">
            <span className="text-[10px] uppercase font-semibold text-slate-500 shrink-0">
              Saved Views:
            </span>
            {savedFilters.map((sf) => (
              <span
                key={sf.id}
                onClick={() => setQuery(sf.query)}
                className="inline-flex items-center gap-1 rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-[11px] text-indigo-300 hover:bg-slate-700 cursor-pointer"
              >
                {sf.name}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFilter(sf.id);
                  }}
                  className="text-slate-500 hover:text-red-400 ml-1"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Save Current Filter Prompt */}
        {query.trim().length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-slate-800/30 border-b border-slate-800 text-xs text-slate-400">
            {isSavingFilter ? (
              <div className="flex items-center gap-2 w-full">
                <input
                  type="text"
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  placeholder="View name (e.g. Low Gas Active)..."
                  className="rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-200 focus:outline-none flex-1"
                />
                <button
                  onClick={handleSaveFilter}
                  className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  Save
                </button>
                <button
                  onClick={() => setIsSavingFilter(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsSavingFilter(true)}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
              >
                + Save query &quot;{query}&quot; as custom view
              </button>
            )}
          </div>
        )}

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No matching commands or tasks found. Try adjusting your query or
              boolean filters.
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.id}
                onClick={() => {
                  item.action();
                  if (controlledIsOpen !== undefined) {
                    onClose?.();
                  } else {
                    setInternalIsOpen(false);
                  }
                }}
                className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs cursor-pointer transition-colors ${
                  idx === selectedIndex
                    ? "bg-indigo-600 text-white"
                    : "text-slate-300 hover:bg-slate-800/80"
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <div className="font-medium">{item.title}</div>
                  {item.subtitle && (
                    <div className="text-[11px] opacity-75">
                      {item.subtitle}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {item.status && (
                    <span className="rounded bg-slate-800/90 border border-slate-700/60 px-2 py-0.5 text-[10px] font-mono text-emerald-400">
                      {item.status}
                    </span>
                  )}
                  {item.gas !== undefined && (
                    <span className="rounded bg-slate-800/90 border border-slate-700/60 px-2 py-0.5 text-[10px] font-mono text-amber-400">
                      {item.gas} gas
                    </span>
                  )}
                  <span className="rounded bg-slate-800/90 border border-slate-700/60 px-2 py-0.5 text-[10px] font-mono text-slate-400">
                    {item.category}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
