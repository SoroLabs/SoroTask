"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/app/context/WalletContext";
import {
  groupCommands,
  rankCommands,
  toSegments,
  type PaletteCommand,
} from "@/src/lib/command-palette/fuzzy";

/**
 * Command Palette — global launcher, searchable across navigation, wallet
 * actions, tasks, and contracts.
 *
 * Opened with Cmd/Ctrl+K directly, and also by the `sorotask:open-command-palette`
 * event that KeyboardShortcutsProvider dispatches from the `/` shortcut. Both
 * routes matter: the provider cannot know which search surface a given page has,
 * so it falls back to the event, and the palette is the guaranteed target.
 */

// Simple SVG Icons to avoid external dependencies
const Icons = {
  Home: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  ),
  List: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
  ),
  Activity: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  ),
  Wallet: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
  ),
  Plus: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  ),
  Sun: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
  ),
  Search: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  ),
  File: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
  ),
  Box: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 16-9 5-9-5V8l9-5 9 5Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
  ),
};

/** A task as far as the palette is concerned. */
export interface PaletteTask {
  id: string;
  functionName?: string;
  contractAddress?: string;
  status?: string;
}

/** A contract as far as the palette is concerned. */
export interface PaletteContract {
  id: string;
  name?: string;
  network?: string;
}

/** Event the shortcut provider dispatches to open the palette. */
export const OPEN_COMMAND_PALETTE_EVENT = "sorotask:open-command-palette";

export interface CommandPaletteProps {
  /** Tasks to make searchable. */
  tasks?: PaletteTask[];
  /** Contracts to make searchable. */
  contracts?: PaletteContract[];
}

export function CommandPalette({ tasks = [], contracts = [] }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const { openConnectModal } = useWallet();

  // Static commands. Kept in a memo so the array identity is stable and the
  // ranking below is not recomputed on every render.
  const staticCommands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: "nav-home",
        title: "Go to Home",
        group: "Navigation",
        hint: "/",
        perform: () => router.push("/"),
      },
      {
        id: "nav-tasks",
        title: "View Tasks",
        group: "Navigation",
        hint: "/tasks",
        keywords: "task list board schedule",
        perform: () => router.push("/tasks"),
      },
      {
        id: "nav-logs",
        title: "Execution Logs",
        group: "Navigation",
        hint: "/keepers",
        keywords: "history runs keeper",
        perform: () => router.push("/keepers"),
      },
      {
        id: "nav-keepers",
        title: "Go to Keepers",
        group: "Navigation",
        hint: "/keepers",
        keywords: "bots operators",
        perform: () => router.push("/keepers"),
      },
      {
        id: "nav-dashboard",
        title: "Go to Dashboard",
        group: "Navigation",
        hint: "/dashboard",
        perform: () => router.push("/dashboard"),
      },
      {
        id: "action-connect",
        title: "Connect Wallet",
        group: "Actions",
        keywords: "wallet fund account stellar",
        perform: () => openConnectModal(),
      },
      {
        id: "action-create",
        title: "Create New Task",
        group: "Actions",
        hint: "/tasks/new",
        keywords: "new add schedule automation",
        perform: () => router.push("/tasks/new"),
      },
      {
        id: "action-gas",
        title: "Gas Optimization",
        group: "Actions",
        hint: "/gas-optimization",
        keywords: "fees vault burn rate",
        perform: () => router.push("/gas-optimization"),
      },
      {
        id: "action-theme",
        title: "Toggle Theme",
        group: "Actions",
        keywords: "dark light appearance",
        perform: () => {
          const root = document.documentElement;
          const next = root.classList.contains("dark") ? "light" : "dark";
          root.classList.remove("dark", "light");
          root.classList.add(next);
        },
      },
    ],
    [router, openConnectModal],
  );

  // Tasks and contracts are folded into the command list so the same ranking,
  // grouping, and keyboard handling covers everything the palette searches.
  const dynamicCommands = useMemo<PaletteCommand[]>(() => {
    const fromTasks = tasks.map((task) => ({
      id: `task-${task.id}`,
      title: task.functionName || task.id,
      group: "Tasks",
      hint: task.status,
      keywords: [task.id, task.contractAddress, task.status].filter(Boolean).join(" "),
      perform: () => router.push(`/tasks?task=${encodeURIComponent(task.id)}`),
    }));
    const fromContracts = contracts.map((contract) => ({
      id: `contract-${contract.id}`,
      title: contract.name || contract.id,
      group: "Contracts",
      hint: contract.network,
      keywords: [contract.id, contract.network].filter(Boolean).join(" "),
      perform: () => router.push(`/tasks?contract=${encodeURIComponent(contract.id)}`),
    }));
    return [...fromTasks, ...fromContracts];
  }, [tasks, contracts, router]);

  const commands = useMemo(
    () => [...staticCommands, ...dynamicCommands],
    [staticCommands, dynamicCommands],
  );

  const recentCommandsKey = "sorotask.command-palette.recent";

  const getRecentCommands = useCallback((): string[] => {
    try {
      const raw = localStorage.getItem(recentCommandsKey);
      const parsed = raw ? JSON.parse(raw) : [];
      // localStorage is user-writable, so the shape is not trusted.
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }, []);

  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    setRecentIds(getRecentCommands());
  }, [getRecentCommands]);

  const saveRecentCommand = useCallback(
    (id: string) => {
      try {
        const recent = getRecentCommands().filter((r) => r !== id);
        const updated = [id, ...recent].slice(0, 5);
        localStorage.setItem(recentCommandsKey, JSON.stringify(updated));
        setRecentIds(updated);
      } catch {
        // Ignore storage errors
      }
    },
    [getRecentCommands],
  );

  /**
   * Rank the whole list against the query.
   *
   * Selection is tracked as an index into this single ranked array. The previous
   * version indexed `filteredCommands` while rendering a differently-ordered
   * "Recent" list, so arrow keys highlighted one command and Enter ran another.
   */
  const ranked = useMemo(() => rankCommands(commands, search), [commands, search]);

  const groups = useMemo(() => groupCommands(ranked), [ranked]);

  /**
   * The list actually rendered: recents when the query is empty, otherwise the
   * ranked results. `visible` is what both selection and Enter operate on, so
   * the highlight and the executed command can never disagree.
   */
  const visible = useMemo(() => {
    if (search.trim()) return ranked;
    if (recentIds.length === 0) return ranked;
    const recents = recentIds
      .map((id) => ranked.find((r) => r.command.id === id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    return recents.length > 0 ? recents : ranked;
  }, [ranked, search, recentIds]);

  const isRecentsView = !search.trim() && visible !== ranked;

  // A shrinking result set must not leave the selection pointing past the end.
  useEffect(() => {
    if (selectedIndex >= visible.length) {
      setSelectedIndex(Math.max(0, visible.length - 1));
    }
  }, [visible.length, selectedIndex]);

  const handleCommand = useCallback(
    (cmd: PaletteCommand) => {
      saveRecentCommand(cmd.id);
      cmd.perform();
      setIsOpen(false);
    },
    [saveRecentCommand],
  );

  const openPalette = useCallback(() => {
    // Remember what had focus so the palette can hand it back on close, rather
    // than dumping the user at the top of the document.
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setIsOpen(true);
  }, []);

  const closePalette = useCallback(() => setIsOpen(false), []);

  // Cmd/Ctrl+K toggles the palette.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // The `/` shortcut in KeyboardShortcutsProvider falls back to this event when
  // the current page exposes no search input of its own.
  useEffect(() => {
    const open = () => openPalette();
    document.addEventListener(OPEN_COMMAND_PALETTE_EVENT, open);
    return () => document.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, open);
  }, [openPalette]);

  // Keyboard navigation within the palette
  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedIndex(0);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (visible.length === 0 ? 0 : (prev + 1) % visible.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          visible.length === 0 ? 0 : prev === 0 ? visible.length - 1 : prev - 1,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = visible[selectedIndex];
        if (selected) {
          handleCommand(selected.command);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      } else if (e.key === "Tab") {
        // The dialog contains only the search field, so Tab would escape to the
        // page behind it and strand a keyboard user there. Trapping it keeps
        // focus inside while the palette is open.
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, visible, selectedIndex, handleCommand, closePalette]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
    // Return focus to whatever opened the palette.
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (restore && typeof restore.focus === "function") {
      restore.focus();
    }
  }, [isOpen]);

  // Keep selected item in view
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      const selected = listRef.current?.querySelector('[aria-selected="true"]');
      selected?.scrollIntoView({ block: "nearest" });
    });
  }, [selectedIndex, isOpen]);

  if (!isOpen) return null;

  const hasResults = visible.length > 0;
  const activeDescendant = hasResults ? `cmd-${visible[selectedIndex]?.command.id}` : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 sm:pt-32">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={closePalette}
        aria-hidden="true"
      />

      {/* Palette Container */}
      <div
        ref={dialogRef}
        className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-neutral-900 border border-neutral-700/50 shadow-2xl ring-1 ring-white/10 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search Input */}
        <div className="flex items-center px-4 py-4 border-b border-neutral-800/80 gap-3">
          <div className="text-neutral-400" aria-hidden="true">
            {Icons.Search}
          </div>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            className="flex-1 bg-transparent border-none text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-0 text-lg"
            placeholder="Type a command or search..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            aria-autocomplete="list"
            aria-controls="command-list"
            aria-expanded={hasResults}
            // Tells assistive tech which option the arrow keys have moved to,
            // without requiring focus to leave the input.
            aria-activedescendant={activeDescendant}
            aria-label="Search commands, tasks, and contracts"
          />
          <div className="flex items-center gap-1 text-xs text-neutral-500 font-mono bg-neutral-800 px-2 py-1 rounded">
            <span>esc</span>
          </div>
        </div>

        {/* Results List */}
        <div className="p-2">
          {!hasResults ? (
            // Kept outside the listbox on purpose: `role="listbox"` may only
            // contain options and groups, so an inline status message inside it
            // is an ARIA violation. The listbox still renders (empty) so
            // `aria-controls` on the input keeps pointing at a real element.
            <div className="py-14 text-center text-sm text-neutral-500" role="status">
              No results found.
            </div>
          ) : null}

          <div
            ref={listRef}
            id="command-list"
            className="max-h-[60vh] overflow-y-auto p-2 scroll-smooth"
            role="listbox"
            aria-label="Command results"
          >
            {hasResults &&
              (isRecentsView ? (
                <>
                  <div className="px-3 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    Recent
                  </div>
                  <div className="flex flex-col gap-1 mb-4">
                    {visible.map((entry, idx) => (
                      <PaletteOption
                        key={entry.command.id}
                        entry={entry}
                        isSelected={idx === selectedIndex}
                        onSelect={() => setSelectedIndex(idx)}
                        onRun={() => handleCommand(entry.command)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                groups.map((group) => (
                  <div key={group.group} className="mb-4 last:mb-0">
                    <div
                      className="px-3 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider"
                      id={`group-${group.group}`}
                    >
                      {group.group}
                    </div>
                    <div
                      className="flex flex-col gap-1"
                      role="group"
                      aria-labelledby={`group-${group.group}`}
                    >
                      {group.items.map((entry) => {
                        const idx = visible.indexOf(entry);
                        return (
                          <PaletteOption
                            key={entry.command.id}
                            entry={entry}
                            isSelected={idx === selectedIndex}
                            onSelect={() => setSelectedIndex(idx)}
                            onRun={() => handleCommand(entry.command)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))
              ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-800/80 px-4 py-3 bg-neutral-950/30 flex items-center justify-between text-xs text-neutral-500">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="flex items-center justify-center w-5 h-5 rounded bg-neutral-800 font-mono">↵</span>
              <span>to select</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="flex items-center justify-center w-5 h-5 rounded bg-neutral-800 font-mono">↑</span>
              <span className="flex items-center justify-center w-5 h-5 rounded bg-neutral-800 font-mono">↓</span>
              <span>to navigate</span>
            </div>
          </div>
          <div>SoroTask Navigation</div>
        </div>
      </div>
    </div>
  );
}

/** One result row, shared by the recents view and the grouped view. */
function PaletteOption({
  entry,
  isSelected,
  onSelect,
  onRun,
}: {
  entry: { command: PaletteCommand; indices: number[] };
  isSelected: boolean;
  onSelect: () => void;
  onRun: () => void;
}) {
  const { command, indices } = entry;
  return (
    <button
      id={`cmd-${command.id}`}
      aria-selected={isSelected}
      className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors w-full text-left ${
        isSelected ? "bg-blue-600/10 text-blue-400" : "text-neutral-300 hover:bg-neutral-800/60"
      }`}
      onClick={onRun}
      onMouseMove={onSelect}
      role="option"
    >
      <div
        className={`flex items-center justify-center ${
          isSelected ? "text-blue-400" : "text-neutral-500"
        }`}
        aria-hidden="true"
      >
        {command.group === "Tasks" ? (
          Icons.List
        ) : command.group === "Contracts" ? (
          Icons.Box
        ) : command.group === "Actions" ? (
          Icons.File
        ) : (
          Icons.Home
        )}
      </div>
      <span className="flex-1" data-command-title={command.title}>
        {toSegments(command.title, indices).map((segment, i) =>
          segment.matched ? (
            <mark
              key={i}
              className="bg-transparent text-blue-300 font-semibold"
            >
              {segment.text}
            </mark>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </span>
      {command.hint && (
        <span className="text-xs text-neutral-500 font-mono" aria-hidden="true">
          {command.hint}
        </span>
      )}
      {isSelected && (
        <span className="text-xs text-blue-500/70 font-mono" aria-hidden="true">
          ↵
        </span>
      )}
    </button>
  );
}
