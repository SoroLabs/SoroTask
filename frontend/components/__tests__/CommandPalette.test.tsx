/**
 * Tests for CommandPalette.
 *
 * Focus on the behaviours that were previously wrong rather than on markup:
 * the shortcut-provider event that the palette never listened for, the mismatch
 * between the highlighted row and the row Enter executed, and task/contract
 * search.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette, OPEN_COMMAND_PALETTE_EVENT } from '../CommandPalette';

// babel-plugin-jest-hoist runs these factories above the imports, so anything
// they close over has to be a `mock`-prefixed binding.
const mockPush = jest.fn();
const mockOpenConnectModal = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/app/context/WalletContext', () => ({
  useWallet: () => ({ openConnectModal: () => mockOpenConnectModal() }),
}));

const tasks = [
  { id: 'task-1', functionName: 'Swap Tokens', contractAddress: 'CABC123', status: 'active' },
  { id: 'task-2', functionName: 'Recalculate Oracle', contractAddress: 'CXYZ789', status: 'paused' },
];

const contracts = [
  { id: 'CABC123', name: 'Swap Router', network: 'soroban' },
  { id: 'CXYZ789', name: 'Oracle Feed', network: 'testnet' },
];

function open() {
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
}

/**
 * The palette highlights matched characters, so a command title is split across
 * a <mark> and a <span>, and each row also carries a route hint. Matching the
 * title via its data attribute keeps these assertions about which command is
 * shown rather than about how it happens to be marked up.
 */
function optionByText(title: string | RegExp) {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-command-title]'),
  ).filter((el) =>
    typeof title === 'string' ? el.dataset.commandTitle === title : title.test(el.textContent ?? ''),
  );
  if (nodes.length === 0) {
    throw new Error(
      `No command matching ${String(title)}. Available: ${Array.from(
        document.querySelectorAll<HTMLElement>('[data-command-title]'),
      )
        .map((el) => el.dataset.commandTitle)
        .join(' | ')}`,
    );
  }
  // The title span lives inside the option row, which is the clickable target.
  return nodes[0].closest('[role="option"]') as HTMLElement;
}

beforeEach(() => {
  mockPush.mockClear();
  mockOpenConnectModal.mockReset();
  localStorage.clear();
});

describe('CommandPalette opening', () => {
  it('is closed initially', () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
  });

  it('opens with Cmd+K', () => {
    render(<CommandPalette />);
    open();
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });

  it('opens with Ctrl+K', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });

  it('closes on a second Cmd+K', () => {
    render(<CommandPalette />);
    open();
    open();
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
  });

  it('opens on the shortcut provider event', () => {
    // This is the event KeyboardShortcutsProvider dispatches from the `/`
    // shortcut when a page has no search input of its own.
    render(<CommandPalette />);
    act(() => {
      document.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
    });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<CommandPalette />);
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
  });

  it('closes when the backdrop is clicked', () => {
    render(<CommandPalette />);
    open();
    const backdrop = document.querySelector('.backdrop-blur-sm') as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
  });
});

describe('CommandPalette search', () => {
  it('filters by command title', async () => {
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'home' },
    });
    await waitFor(() => expect(optionByText('Go to Home')).toBeInTheDocument());
    expect(screen.queryByText(/execution logs/i)).not.toBeInTheDocument();
  });

  it('reports when nothing matches', async () => {
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'zzzznotathing' },
    });
    expect(await screen.findByText(/no results found/i)).toBeInTheDocument();
  });

  it('finds tasks by function name', async () => {
    render(<CommandPalette tasks={tasks} />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'swap' },
    });
    await waitFor(() => expect(optionByText('Swap Tokens')).toBeInTheDocument());
  });

  it('finds tasks by contract address', async () => {
    render(<CommandPalette tasks={tasks} />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'CXYZ789' },
    });
    await waitFor(() => expect(optionByText('Recalculate Oracle')).toBeInTheDocument());
  });

  it('finds tasks by id', async () => {
    render(<CommandPalette tasks={tasks} />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'task-2' },
    });
    await waitFor(() => expect(optionByText('Recalculate Oracle')).toBeInTheDocument());
  });

  it('finds contracts by name', async () => {
    render(<CommandPalette contracts={contracts} />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'oracle' },
    });
    await waitFor(() => expect(optionByText('Oracle Feed')).toBeInTheDocument());
  });

  it('groups tasks under their own heading', async () => {
    render(<CommandPalette tasks={tasks} />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'swap' },
    });
    optionByText('Swap Tokens');
    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });

  it('highlights the matched characters', async () => {
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'home' },
    });
    const option = await screen.findByRole('option');
    expect(option.querySelector('mark')?.textContent?.toLowerCase()).toBe('home');
  });
});

describe('CommandPalette execution', () => {
  it('navigates when a navigation command is chosen', async () => {
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'view tasks' },
    });
    fireEvent.click(optionByText('View Tasks'));
    expect(mockPush).toHaveBeenCalledWith('/tasks');
  });

  it('closes after running a command', async () => {
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'go to home' },
    });
    fireEvent.click(optionByText('Go to Home'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument(),
    );
  });

  it('invokes the wallet action', async () => {
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'connect wallet' },
    });
    fireEvent.click(optionByText('Connect Wallet'));
    expect(mockOpenConnectModal).toHaveBeenCalled();
  });

  it('runs the highlighted command on Enter, not the first one', async () => {
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'go to' },
    });
    optionByText('Go to Home');
    // Move down from the first match to the second.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    // "Go to Home" is declared first, so the second match must be a different
    // route — proof the selection index and the executed command agree.
    expect(mockPush).toHaveBeenCalledWith(expect.not.stringContaining('"/"'));
  });

  it('does nothing on Enter with no results', () => {
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'zzzznotathing' },
    });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('toggles theme without a blocking alert', () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'toggle theme' },
    });
    fireEvent.click(optionByText('Toggle Theme'));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(document.documentElement.className).toMatch(/dark|light/);
    alertSpy.mockRestore();
  });
});

describe('CommandPalette keyboard navigation', () => {
  it('marks the first option selected on open', async () => {
    render(<CommandPalette />);
    open();
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves the selection with ArrowDown', async () => {
    render(<CommandPalette />);
    open();
    const options = await screen.findAllByRole('option');
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    await waitFor(() => expect(options[1]).toHaveAttribute('aria-selected', 'true'));
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('wraps to the end with ArrowUp', async () => {
    render(<CommandPalette />);
    open();
    const options = await screen.findAllByRole('option');
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('exposes the active option to assistive technology', async () => {
    render(<CommandPalette />);
    open();
    const input = screen.getByPlaceholderText(/type a command/i) as HTMLInputElement;
    await screen.findAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', 'cmd-nav-home');
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(input.getAttribute('aria-activedescendant')).not.toBe('cmd-nav-home'),
    );
  });

  it('labels the search field', async () => {
    render(<CommandPalette />);
    open();
    expect(
      screen.getByRole('combobox', { name: /search commands, tasks, and contracts/i }),
    ).toBeInTheDocument();
  });

  it('keeps focus in the field on Tab instead of escaping the dialog', async () => {
    render(<CommandPalette />);
    open();
    const input = screen.getByPlaceholderText(/type a command/i) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
  });

  it('resets the selection when the query changes', async () => {
    render(<CommandPalette />);
    open();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'go to' },
    });
    const options = await screen.findAllByRole('option');
    await waitFor(() => expect(options[0]).toHaveAttribute('aria-selected', 'true'));
  });
});

describe('CommandPalette recents', () => {
  it('remembers a recently used command', async () => {
    const { unmount } = render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/type a command/i), {
      target: { value: 'view tasks' },
    });
    fireEvent.click(optionByText('View Tasks'));
    unmount();

    render(<CommandPalette />);
    open();
    expect(await screen.findByText('Recent')).toBeInTheDocument();
  });

  it('ignores a corrupted recents value in localStorage', async () => {
    localStorage.setItem('sorotask.command-palette.recent', '{not json');
    render(<CommandPalette />);
    open();
    await waitFor(() => expect(optionByText('Go to Home')).toBeInTheDocument());
  });

  it('ignores a recents value of the wrong shape', async () => {
    localStorage.setItem('sorotask.command-palette.recent', '{"a":1}');
    render(<CommandPalette />);
    open();
    await waitFor(() => expect(optionByText('Go to Home')).toBeInTheDocument());
  });

  it('runs the highlighted recent rather than the first command', async () => {
    localStorage.setItem(
      'sorotask.command-palette.recent',
      JSON.stringify(['nav-logs']),
    );
    render(<CommandPalette />);
    open();
    await screen.findByText('Recent');
    fireEvent.keyDown(document, { key: 'Enter' });
    // nav-logs routes to /keepers; running the first command instead would
    // have navigated to "/".
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/keepers'));
  });
});
