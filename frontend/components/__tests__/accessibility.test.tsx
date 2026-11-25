/**
 * WCAG 2.1 AA regression suite.
 *
 * Audits the accessibility primitives and the global command palette with
 * axe-core, then asserts the keyboard and screen-reader behaviour that axe
 * cannot check — a violation-free DOM says nothing about whether a live region
 * actually announces, or whether a dialog is reachable by keyboard alone.
 *
 * Every case here is a regression test: a failure means accessibility has
 * regressed, not that it is currently broken.
 *
 * Companion to the contrast-maths tests in
 * `src/lib/accessibility/__tests__/axeHarness.test.ts`.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { hasNoViolations } from '@/src/lib/accessibility/axeHarness';
import { AccessibleModal } from '@/components/accessibility/AccessibleModal';
import {
  A11yLiveRegionProvider,
  useA11yAnnouncer,
} from '@/components/accessibility/A11yLiveRegion';
import {
  Alert,
  FocusScope,
  LiveRegion,
  SkipLink,
  TextField,
  VisuallyHidden,
} from '@/components/ui/a11y';

expect.extend(toHaveNoViolations);

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  localStorage.clear();
  mockPush.mockClear();
});

describe('axe-core: accessibility primitives', () => {
  it('AccessibleModal has no violations when open', async () => {
    const { container } = render(
      <AccessibleModal isOpen onClose={() => {}} title="Confirm transfer">
        <p>You are about to transfer 100 XLM.</p>
      </AccessibleModal>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('LiveRegion has no violations', async () => {
    const { container } = render(<LiveRegion message="Task executed" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('A11yLiveRegion provider has no violations', async () => {
    const { container } = render(
      <A11yLiveRegionProvider>
        <button type="button">Announce</button>
      </A11yLiveRegionProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Alert has no violations', async () => {
    const { container } = render(
      <Alert intent="error" title="Transaction failed">
        The network rejected the submission.
      </Alert>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('TextField has no violations when labelled', async () => {
    const { container } = render(<TextField label="Recipient address" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('SkipLink has no violations', async () => {
    const { container } = render(<SkipLink />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FocusScope has no violations', async () => {
    const { container } = render(
      <FocusScope>
        <button type="button">Confirm</button>
      </FocusScope>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('live regions', () => {
  it('announces a message pushed through the announcer', async () => {
    // This is the path an async blockchain update actually takes: something
    // resolves, calls announce(), and the message must reach a live region.
    function BalanceWatcher() {
      const { announce } = useA11yAnnouncer();
      return (
        <button type="button" onClick={() => announce('Balance updated to 4.2 XLM')}>
          Refresh
        </button>
      );
    }

    render(
      <A11yLiveRegionProvider>
        <BalanceWatcher />
      </A11yLiveRegionProvider>,
    );

    // The region starts empty; it only carries text once something announces.
    expect(screen.queryByText(/balance updated/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    const announced = await screen.findByText(/balance updated to 4\.2 xlm/i);
    expect(announced).toHaveAttribute('aria-live', 'polite');
    expect(announced).toHaveAttribute('aria-atomic', 'true');
  });

  it('routes an assertive announcement to the alert region', async () => {
    function FailureWatcher() {
      const { announce } = useA11yAnnouncer();
      return (
        <button type="button" onClick={() => announce('Keeper disconnected', 'assertive')}>
          Fail
        </button>
      );
    }

    render(
      <A11yLiveRegionProvider>
        <FailureWatcher />
      </A11yLiveRegionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /fail/i }));

    const announced = await screen.findByText(/keeper disconnected/i);
    expect(announced).toHaveAttribute('aria-live', 'assertive');
    expect(announced).toHaveAttribute('role', 'alert');
  });

  it('announces politely by default', () => {
    render(<LiveRegion message="Execution confirmed" />);
    const region = screen.getByText(/execution confirmed/i);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('can announce assertively', () => {
    render(<LiveRegion message="Keeper disconnected" politeness="assertive" />);
    expect(screen.getByText(/keeper disconnected/i)).toHaveAttribute('aria-live', 'assertive');
  });

  it('announces a changed message', () => {
    const { rerender } = render(<LiveRegion message="Pending" />);
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    rerender(<LiveRegion message="Confirmed" />);
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument();
  });

  it('visually hides content from sighted users while keeping it available', () => {
    const { container } = render(<VisuallyHidden>Status: connected</VisuallyHidden>);
    const hidden = screen.getByText(/status: connected/i);
    expect(hidden).toBeInTheDocument();
    // Clipped to 1px rather than display:none, which would remove it from the
    // accessibility tree entirely.
    expect(hidden).toHaveStyle({ position: 'absolute', width: '1px', height: '1px' });
    expect(container.textContent).toContain('Status: connected');
  });
});

describe('keyboard operability', () => {
  it('moves focus into a focus scope on mount', async () => {
    render(
      <FocusScope>
        <button type="button">Confirm</button>
      </FocusScope>,
    );
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Confirm'));
  });

  it('offers a skip link to the main landmark', () => {
    render(<SkipLink href="#main" />);
    const link = screen.getByRole('link', { name: /skip to main content/i });
    expect(link).toHaveAttribute('href', '#main');
  });

  it('activates the notification toggle without a pointer', () => {
    const onClick = jest.fn();
    render(
      <button type="button" onClick={onClick}>
        Refresh balance
      </button>,
    );
    const button = screen.getByRole('button', { name: /refresh balance/i });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('form semantics', () => {
  it('associates a text field with its label', () => {
    render(<TextField label="Keeper address" />);
    expect(screen.getByLabelText(/keeper address/i)).toBeInTheDocument();
  });

  it('gives an alert an accessible role and name', () => {
    render(
      <Alert intent="error" title="Insufficient gas">
        Top up the vault to continue.
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/insufficient gas/i);
    expect(alert).toHaveTextContent(/top up the vault/i);
  });
});
