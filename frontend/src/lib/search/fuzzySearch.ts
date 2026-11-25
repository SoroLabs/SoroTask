export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  category: "Navigation" | "Tasks" | "Contracts" | "Actions";
  status?: string;
  gas?: number;
  metadata?: Record<string, any>;
  action: () => void;
}

export interface SavedFilter {
  id: string;
  name: string;
  query: string;
  createdAt: number;
}

export const SAVED_FILTERS_STORAGE_KEY = "sorotask.saved_filters";

/**
 * Retrieve saved custom filter views from local storage.
 */
export function getSavedFilters(): SavedFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(SAVED_FILTERS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.error("Failed to parse saved filters from local storage", err);
    return [];
  }
}

/**
 * Save a custom filter query into local storage.
 */
export function saveCustomFilter(name: string, query: string): SavedFilter {
  const filters = getSavedFilters();
  const filter: SavedFilter = {
    id: `filter_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name,
    query,
    createdAt: Date.now(),
  };
  filters.push(filter);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      SAVED_FILTERS_STORAGE_KEY,
      JSON.stringify(filters),
    );
  }
  return filter;
}

/**
 * Delete a custom filter query from local storage.
 */
export function deleteCustomFilter(id: string): void {
  const filters = getSavedFilters().filter((f) => f.id !== id);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      SAVED_FILTERS_STORAGE_KEY,
      JSON.stringify(filters),
    );
  }
}

/**
 * Matches an individual single condition like "status:active", "gas:<10", or "transfer".
 */
function matchSingleClause(cmd: CommandItem, clause: string): boolean {
  const trimmed = clause.trim();
  if (!trimmed) return true;

  // Check for field:value, field:<val, field:>val, field:<=val, field:>=val
  const fieldMatch = trimmed.match(/^([a-zA-Z0-9_-]+):([<>=!~]?)(.+)$/);
  if (fieldMatch) {
    const field = fieldMatch[1].toLowerCase();
    const op = fieldMatch[2];
    const val = fieldMatch[3].toLowerCase();

    const targetVal =
      field === "status"
        ? cmd.status?.toLowerCase()
        : field === "gas"
          ? cmd.gas
          : field === "category"
            ? cmd.category.toLowerCase()
            : field === "title"
              ? cmd.title.toLowerCase()
              : cmd.metadata?.[field];

    if (targetVal === undefined || targetVal === null) return false;

    if (op === "<") {
      return Number(targetVal) < Number(val);
    } else if (op === ">") {
      return Number(targetVal) > Number(val);
    } else if (op === "<=") {
      return Number(targetVal) <= Number(val);
    } else if (op === ">=") {
      return Number(targetVal) >= Number(val);
    } else {
      return String(targetVal).toLowerCase().includes(val);
    }
  }

  // Fallback to fuzzy substring search on title, subtitle, and category
  const q = trimmed.toLowerCase();
  const titleMatch = cmd.title.toLowerCase().includes(q);
  const subMatch = cmd.subtitle
    ? cmd.subtitle.toLowerCase().includes(q)
    : false;
  const catMatch = cmd.category.toLowerCase().includes(q);
  return titleMatch || subMatch || catMatch;
}

/**
 * Elastic query builder evaluating boolean clauses (AND, OR).
 * Example: `status:active AND gas:<10`
 */
export function evaluateElasticQuery(cmd: CommandItem, query: string): boolean {
  if (!query.trim()) return true;

  // Top-level OR split
  const orParts = query.split(/\s+OR\s+/i);
  return orParts.some((orClause) => {
    // Sub-level AND split
    const andParts = orClause.split(/\s+AND\s+/i);
    return andParts.every((andClause) => matchSingleClause(cmd, andClause));
  });
}

/**
 * Fuzzy search commands with instant boolean elastic filtering.
 */
export function fuzzySearchCommands(
  commands: CommandItem[],
  query: string,
): CommandItem[] {
  if (!query.trim()) return commands;
  return commands.filter((cmd) => evaluateElasticQuery(cmd, query));
}
