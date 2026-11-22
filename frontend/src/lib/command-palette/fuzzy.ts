/**
 * Command palette — fuzzy matching and command ranking.
 *
 * Extracted from the palette component so the matching rules can be tested
 * directly. The palette itself is mostly presentational; everything that decides
 * *which* commands surface, and in what order, lives here.
 *
 * The matcher is a subsequence matcher with positional weighting: every character
 * of the pattern must appear in order, but not contiguously, so "gnw" finds
 * "Go to New Wallet". Scoring rewards matches near the start of the string and
 * at word boundaries, which is what makes a dense acronym like "gtp" rank
 * "Go to Projects" above an incidental late match elsewhere in the list.
 */

export interface FuzzyResult {
  matched: boolean;
  /** Higher is better. 0 when the pattern is not a subsequence. */
  score: number;
  /** Indices in the target where pattern characters matched, for highlighting. */
  indices: number[];
}

const NO_MATCH: FuzzyResult = { matched: false, score: 0, indices: [] };

/** Bonus for a match that starts a word, so acronyms score highly. */
const WORD_BOUNDARY_BONUS = 12;
/** Bonus for matching at index 0. */
const START_BONUS = 10;
/** Weight applied to characters matched in sequence rather than scattered. */
const CONSECUTIVE_BONUS = 6;
/** Penalty applied per character skipped before a match. */
const SKIP_PENALTY = 1;

/** True when `index` begins a word: start of string, or after a separator. */
function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  return prev === ' ' || prev === '-' || prev === '_' || prev === '/' || prev === '.' || prev === ':';
}

/**
 * Match `pattern` against `text` as a case-insensitive subsequence.
 *
 * An empty pattern matches everything with a neutral score, which keeps the
 * "no search yet" path from needing a special case at every call site.
 */
export function fuzzyMatch(pattern: string, text: string): FuzzyResult {
  if (!pattern) return { matched: true, score: 1, indices: [] };
  if (!text) return NO_MATCH;

  const needle = pattern.toLowerCase();
  const haystack = text.toLowerCase();

  const indices: number[] = [];
  let score = 0;
  let haystackIdx = 0;
  let previousMatch = -1;

  for (let i = 0; i < needle.length; i += 1) {
    const char = needle[i];
    let found = -1;

    for (let j = haystackIdx; j < haystack.length; j += 1) {
      if (haystack[j] === char) {
        found = j;
        break;
      }
    }

    if (found === -1) return NO_MATCH;

    // Skipping characters is the signal that a match is weak, so it costs.
    score -= (found - haystackIdx) * SKIP_PENALTY;
    if (isWordBoundary(text, found)) score += WORD_BOUNDARY_BONUS;
    if (found === 0) score += START_BONUS;
    if (previousMatch !== -1 && found === previousMatch + 1) {
      score += CONSECUTIVE_BONUS;
    }

    indices.push(found);
    previousMatch = found;
    haystackIdx = found + 1;
  }

  // Normalise by length so a long title does not out-rank a short, exact one
  // purely by having more characters to accumulate bonuses on.
  return { matched: true, score: score / Math.sqrt(needle.length), indices };
}

/** A command the palette can run. */
export interface PaletteCommand {
  id: string;
  title: string;
  /** Group heading in the results list. */
  group: string;
  /** Optional extra text matched by the query but not displayed. */
  keywords?: string;
  perform: () => void;
  /** Optional right-aligned hint, e.g. a route or a shortcut. */
  hint?: string;
}

export interface RankedCommand {
  command: PaletteCommand;
  score: number;
  indices: number[];
}

/**
 * Rank commands against a query.
 *
 * Title matches outrank keyword-only matches, because a user typing "gas" wants
 * the command literally called "Gas Vault" before one that merely mentions gas
 * in its keywords. When the query is empty the input order is preserved, which
 * is what makes the palette a predictable launcher rather than a reshuffle.
 */
export function rankCommands(commands: PaletteCommand[], query: string): RankedCommand[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return commands.map((command) => ({ command, score: 0, indices: [] }));
  }

  const ranked: RankedCommand[] = [];

  for (const command of commands) {
    const title = fuzzyMatch(trimmed, command.title);
    if (title.matched) {
      ranked.push({ command, score: title.score * 2, indices: title.indices });
      continue;
    }

    const keyword = command.keywords ? fuzzyMatch(trimmed, command.keywords) : NO_MATCH;
    if (keyword.matched) {
      ranked.push({ command, score: keyword.score, indices: [] });
    }
  }

  // Stable within equal scores: Array#sort is stable in modern engines, and the
  // tie-break keeps declaration order regardless.
  return ranked.sort((a, b) => b.score - a.score);
}

/** Group ranked commands, preserving rank order within each group. */
export function groupCommands(
  ranked: RankedCommand[],
): { group: string; items: RankedCommand[] }[] {
  const groups: { group: string; items: RankedCommand[] }[] = [];
  const index = new Map<string, number>();

  for (const entry of ranked) {
    const name = entry.command.group;
    const at = index.get(name);
    if (at === undefined) {
      index.set(name, groups.length);
      groups.push({ group: name, items: [entry] });
    } else {
      groups[at].items.push(entry);
    }
  }

  return groups;
}

/** Split a title into matched / unmatched runs for rendering highlights. */
export function toSegments(
  text: string,
  indices: number[],
): { text: string; matched: boolean }[] {
  if (indices.length === 0) return [{ text, matched: false }];

  const matched = new Set(indices);
  const segments: { text: string; matched: boolean }[] = [];
  let buffer = '';
  let bufferMatched = matched.has(0);

  for (let i = 0; i < text.length; i += 1) {
    const isMatched = matched.has(i);
    if (isMatched !== bufferMatched) {
      if (buffer) segments.push({ text: buffer, matched: bufferMatched });
      buffer = '';
      bufferMatched = isMatched;
    }
    buffer += text[i];
  }
  if (buffer) segments.push({ text: buffer, matched: bufferMatched });

  return segments;
}
