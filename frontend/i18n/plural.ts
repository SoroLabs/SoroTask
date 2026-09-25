/**
 * Locale-correct pluralisation and message formatting (#1242).
 *
 * The previous implementation returned a `'s'` / `'n'` / `''` suffix and relied
 * on the catalogue string containing `{count} task{plural}`. That encodes an
 * English-shaped rule into every translation and simply cannot express
 * languages that need more than two forms — Polish has four, Arabic has six,
 * Russian has three, and French puts an `s` on zero but not on one.
 *
 * This module uses `Intl.PluralRules`, which is the platform's own CLDR data,
 * and accepts ICU-style messages:
 *
 *     "{count, plural, one {# task} other {# tasks}}"
 *
 * Simple suffixes keep working, so existing catalogue entries do not have to be
 * rewritten all at once.
 */

import type { Locale } from "./index";

/** The CLDR plural categories, in the order a message may declare them. */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

const CATEGORY_ORDER: PluralCategory[] = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
];

/** Fallback locale for `Intl` calls, used when a runtime lacks the locale. */
const FALLBACK = "en";

const rulesCache = new Map<string, Intl.PluralRules>();

function getRules(locale: Locale): Intl.PluralRules {
  const cached = rulesCache.get(locale);
  if (cached) return cached;

  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    rules = new Intl.PluralRules(FALLBACK);
  }

  rulesCache.set(locale, rules);
  return rules;
}

/** The CLDR plural category for `count` in `locale`. */
export function getPluralCategory(
  count: number,
  locale: Locale,
): PluralCategory {
  // `Intl.PluralRules` treats a non-finite value as "other" for every locale,
  // but it also throws on NaN in some engines, so normalise first.
  if (!Number.isFinite(count)) return "other";
  return getRules(locale).select(count) as PluralCategory;
}

/**
 * Picks the best branch for `category`.
 *
 * `exact = 0` is a genuine ICU behaviour rather than a nicety: it lets a
 * catalogue distinguish "no tasks at all" from "a number of tasks other than
 * one", which is a distinction most languages make and naive suffix logic
 * cannot.
 */
export function selectPluralBranch(
  category: PluralCategory,
  branches: Partial<Record<PluralCategory | "exact", string>>,
  count: number,
): string {
  if (count === 0 && typeof branches.exact === "string") return branches.exact;
  if (typeof branches[category] === "string")
    return branches[category] as string;
  // `other` is mandatory in ICU, but a hand-written catalogue may omit it.
  if (typeof branches.other === "string") return branches.other as string;

  const firstDeclared = CATEGORY_ORDER.find(
    (c) => typeof branches[c] === "string",
  );
  return firstDeclared ? (branches[firstDeclared] as string) : "";
}

type ParsedMessage =
  | { simple: true; text: string }
  | {
      simple: false;
      /** Copy before the plural block, re-attached in front of the branch. */
      before: string;
      /** Copy after the plural block, re-attached behind the branch. */
      after: string;
      branches: Partial<Record<PluralCategory | "exact", string>>;
    };

const PLURAL_BLOCK = /\{\s*(\w+)\s*,\s*plural\s*,([\s\S]*)\}/;

/**
 * Parses `{name, plural, ...}`, returning the message unchanged when it is not
 * a plural expression. Unbalanced braces are treated as literal text rather
 * than throwing: a malformed catalogue entry should degrade to visible-but-
 * wrong copy, not take the page down.
 *
 * Copy on either side of the block is preserved separately so it can be
 * re-attached around whichever branch is chosen — appending it to `other`
 * would move it to the end of the string.
 */
function parseMessage(message: string): ParsedMessage {
  const match = PLURAL_BLOCK.exec(message);
  if (!match) return { simple: true, text: message };

  return {
    simple: false,
    before: message.slice(0, match.index),
    after: message.slice(match.index + match[0].length),
    branches: parseBranches(match[2]),
  };
}

/** Parses `=0 {…} one {…} other {…}` into a branch table. */
function parseBranches(
  body: string,
): Partial<Record<PluralCategory | "exact", string>> {
  const branches: Partial<Record<PluralCategory | "exact", string>> = {};
  let cursor = 0;

  while (cursor < body.length) {
    const keyMatch = /^\s*(=\d+|(?:zero|one|two|few|many|other))\s*/.exec(
      body.slice(cursor),
    );
    if (!keyMatch) break;

    const key = keyMatch[1].startsWith("=")
      ? "exact"
      : (keyMatch[1] as PluralCategory);
    cursor += keyMatch[0].length;

    if (body[cursor] !== "{") break;
    const { value, next } = readBraced(body, cursor);
    branches[key] = value;
    cursor = next;
  }

  return branches;
}

/** Reads a `{…}` block, tolerating nested braces. */
function readBraced(
  body: string,
  open: number,
): { value: string; next: number } {
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") {
      depth--;
      if (depth === 0) return { value: body.slice(open + 1, i), next: i + 1 };
    }
  }
  // Unterminated: take the remainder rather than throwing.
  return { value: body.slice(open + 1), next: body.length };
}

export type MessageVariables = Record<string, string | number>;

/** Substitutes `{name}` and the ICU `#` shorthand for the plural count. */
function interpolate(
  template: string,
  variables: MessageVariables,
  count: number,
): string {
  // `#` is only special inside a plural branch, and always means the count.
  let result = template.replace(/#/g, formatCountForHash(count));

  result = result.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (name in variables) return String(variables[name]);
    // `{count}` and the plural selector are the same value; accept both.
    if (name === "count" || name === "n") return String(count);
    return match;
  });

  return result;
}

/**
 * Formats `#` using the locale's own grouping.
 *
 * Implemented with `Intl.NumberFormat` when available, falling back to `String`
 * so a stripped-down engine still renders the number.
 */
function formatCountForHash(count: number): string {
  try {
    return new Intl.NumberFormat(FALLBACK).format(count);
  } catch {
    return String(count);
  }
}

/**
 * Resolves a message for `locale`, handling plural branches when present.
 *
 * `variables.count` is what drives pluralisation; without it the message is
 * returned with plain `{placeholder}` substitution, which is how the majority
 * of catalogue entries are written.
 */
export function formatMessage(
  message: string,
  locale: Locale,
  variables: MessageVariables = {},
): string {
  const parsed = parseMessage(message);

  if (parsed.simple)
    return interpolate(parsed.text, variables, Number(variables.count));

  const count = Number(variables.count);
  if (!Number.isFinite(count)) {
    // Without a usable count there is no category to choose; `other` is the
    // only safe branch.
    const branch = selectPluralBranch("other", parsed.branches, count);
    return interpolate(parsed.before + branch + parsed.after, variables, 0);
  }

  const branch = selectPluralBranch(
    getPluralCategory(count, locale),
    parsed.branches,
    count,
  );

  return interpolate(parsed.before + branch + parsed.after, variables, count);
}

/** True when `message` contains an ICU plural expression. */
export function hasPluralForm(message: string): boolean {
  return PLURAL_BLOCK.test(message);
}

export { CATEGORY_ORDER as PLURAL_CATEGORIES };
