/**
 * Tests for command palette fuzzy matching and ranking.
 *
 * The matching rules decide what a power user sees first, so the cases below
 * pin the behaviour that makes the palette feel predictable: subsequence
 * matching, word-boundary preference, and a stable order for an empty query.
 */

import {
  fuzzyMatch,
  groupCommands,
  rankCommands,
  toSegments,
  type PaletteCommand,
} from '../fuzzy';

const cmd = (id: string, title: string, group = 'Navigation', keywords?: string): PaletteCommand => ({
  id,
  title,
  group,
  keywords,
  perform: () => {},
  keywords,
} as PaletteCommand);

describe('fuzzyMatch', () => {
  it('matches an empty pattern against anything', () => {
    const result = fuzzyMatch('', 'anything');
    expect(result.matched).toBe(true);
    expect(result.score).toBe(1);
  });

  it('rejects a pattern that is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'Go to Home').matched).toBe(false);
  });

  it('matches characters in order but not contiguously', () => {
    const result = fuzzyMatch('gtp', 'Go to Projects');
    expect(result.matched).toBe(true);
    // G at 0, the 't' of "to" at 3, and the P of "Projects" at 6.
    expect(result.indices).toEqual([0, 3, 6]);
  });

  it('is case insensitive', () => {
    expect(fuzzyMatch('GTP', 'Go to Projects').matched).toBe(true);
    expect(fuzzyMatch('gtp', 'GO TO PROJECTS').matched).toBe(true);
  });

  it('scores a prefix match above a scattered one', () => {
    const prefix = fuzzyMatch('gas', 'Gas Vault');
    const scattered = fuzzyMatch('gas', 'Manage the Analytics Grid Somewhere');
    expect(prefix.matched && scattered.matched).toBe(true);
    expect(prefix.score).toBeGreaterThan(scattered.score);
  });

  it('scores a word-boundary match above a mid-word match', () => {
    const boundary = fuzzyMatch('gv', 'Gas Vault Manager');
    const midWord = fuzzyMatch('gv', 'Aggregator Vendor');
    expect(boundary.score).toBeGreaterThan(midWord.score);
  });

  it('scores a match at the start above one at the end', () => {
    const early = fuzzyMatch('act', 'Action Center');
    const late = fuzzyMatch('act', 'Reactor Compact');
    expect(early.score).toBeGreaterThan(late.score);
  });

  it('rewards consecutive characters', () => {
    const consecutive = fuzzyMatch('vault', 'Vault');
    // Deliberately not underscore-separated: an underscore counts as a word
    // boundary, so using one here would score every character as a fresh start
    // and mask the effect being tested.
    const scattered = fuzzyMatch('vault', 'Vxxaxxxuxxlxxt');
    expect(consecutive.matched && scattered.matched).toBe(true);
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it('rejects a match against an empty target', () => {
    expect(fuzzyMatch('a', '').matched).toBe(false);
  });

  it('returns no indices for a non-match', () => {
    expect(fuzzyMatch('q', 'abc').indices).toEqual([]);
  });
});

describe('rankCommands', () => {
  const commands = [
    cmd('nav-home', 'Go to Home'),
    cmd('nav-tasks', 'Go to Tasks'),
    cmd('action-create', 'Create New Task', 'Actions'),
    cmd('action-wallet', 'Connect Wallet', 'Actions', 'wallet connect fund'),
  ];

  it('preserves declaration order for an empty query', () => {
    const ranked = rankCommands(commands, '');
    expect(ranked.map((r) => r.command.id)).toEqual([
      'nav-home',
      'nav-tasks',
      'action-create',
      'action-wallet',
    ]);
  });

  it('treats a whitespace-only query as empty', () => {
    expect(rankCommands(commands, '   ')).toHaveLength(commands.length);
  });

  it('drops commands that do not match', () => {
    const ranked = rankCommands(commands, 'wallet');
    expect(ranked.map((r) => r.command.id)).toEqual(['action-wallet']);
  });

  it('ranks a title match above a keyword-only match', () => {
    const ranked = rankCommands(
      [cmd('a', 'Manage Wallet Balances'), cmd('b', 'Settings', 'General', 'wallet options')],
      'wallet',
    );
    expect(ranked[0].command.id).toBe('a');
  });

  it('finds commands through their keywords', () => {
    const ranked = rankCommands(commands, 'fund');
    expect(ranked.map((r) => r.command.id)).toEqual(['action-wallet']);
  });

  it('returns nothing when no command matches', () => {
    expect(rankCommands(commands, 'zzzzz')).toEqual([]);
  });

  it('handles an empty command list', () => {
    expect(rankCommands([], 'anything')).toEqual([]);
  });

  it('carries match indices through for highlighting', () => {
    const ranked = rankCommands([cmd('a', 'Gas Vault')], 'gas');
    expect(ranked[0].indices).toEqual([0, 1, 2]);
  });

  it('is stable for equal scores', () => {
    const tied = [cmd('first', 'Alpha One'), cmd('second', 'Alpha Two')];
    const ranked = rankCommands(tied, 'alpha');
    expect(ranked.map((r) => r.command.id)).toEqual(['first', 'second']);
  });
});

describe('groupCommands', () => {
  it('groups by the command group', () => {
    const ranked = rankCommands(
      [cmd('a', 'One', 'Nav'), cmd('b', 'Two', 'Actions'), cmd('c', 'Three', 'Nav')],
      '',
    );
    const groups = groupCommands(ranked);
    expect(groups.map((g) => g.group)).toEqual(['Nav', 'Actions']);
    expect(groups[0].items).toHaveLength(2);
  });

  it('preserves rank order inside a group', () => {
    const ranked = rankCommands(
      [cmd('a', 'Task Alpha'), cmd('b', 'Task Beta')],
      'task',
    );
    const groups = groupCommands(ranked);
    const ids = groups[0].items.map((i) => i.command.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('returns nothing for an empty ranking', () => {
    expect(groupCommands([])).toEqual([]);
  });
});

describe('toSegments', () => {
  it('returns a single unmatched segment with no indices', () => {
    expect(toSegments('Gas Vault', [])).toEqual([{ text: 'Gas Vault', matched: false }]);
  });

  it('splits matched characters out', () => {
    expect(toSegments('Gas Vault', [0, 1, 2])).toEqual([
      { text: 'Gas', matched: true },
      { text: ' Vault', matched: false },
    ]);
  });

  it('handles non-contiguous matches', () => {
    expect(toSegments('abcd', [0, 2])).toEqual([
      { text: 'a', matched: true },
      { text: 'b', matched: false },
      { text: 'c', matched: true },
      { text: 'd', matched: false },
    ]);
  });

  it('handles a match at the end', () => {
    expect(toSegments('abc', [2])).toEqual([
      { text: 'ab', matched: false },
      { text: 'c', matched: true },
    ]);
  });

  it('reassembles the original text exactly', () => {
    const title = 'Go to Gas Vault Manager';
    const segments = toSegments(title, [0, 3, 6, 9]);
    expect(segments.map((s) => s.text).join('')).toBe(title);
  });
});
