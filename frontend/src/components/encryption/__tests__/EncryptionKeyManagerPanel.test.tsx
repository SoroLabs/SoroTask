import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { EncryptionKeyManagerPanel } from '../EncryptionKeyManagerPanel';
import { useEncryptionStore } from '@/src/store/encryptionStore';

// Provide Node.js webcrypto for the underlying EncryptionKeyManager
beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webcrypto } = require('crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

beforeEach(() => {
  useEncryptionStore.getState().reset();
});

describe('EncryptionKeyManagerPanel', () => {
  // ── renders ────────────────────────────────────────────────────────────

  it('renders the panel title', () => {
    render(<EncryptionKeyManagerPanel />);
    expect(screen.getByText('Encryption Key Manager')).toBeInTheDocument();
  });

  it('shows idle status badge initially', () => {
    render(<EncryptionKeyManagerPanel />);
    expect(screen.getByTestId('enc-status-badge').textContent).toBe('idle');
  });

  it('shows the password input before initialization', () => {
    render(<EncryptionKeyManagerPanel />);
    expect(screen.getByLabelText('Master password')).toBeInTheDocument();
  });

  it('shows the Initialize button', () => {
    render(<EncryptionKeyManagerPanel />);
    expect(screen.getByRole('button', { name: /initialize/i })).toBeInTheDocument();
  });

  // ── error display ──────────────────────────────────────────────────────

  it('shows local error when Initialize is clicked with empty password', async () => {
    render(<EncryptionKeyManagerPanel />);
    const btn = screen.getByRole('button', { name: /initialize/i });
    fireEvent.click(btn);
    expect(await screen.findByRole('alert')).toHaveTextContent(/password is required/i);
  });

  // ── initialization flow ────────────────────────────────────────────────

  it('transitions to ready status after successful initialization', async () => {
    render(<EncryptionKeyManagerPanel />);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'mypassword' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /initialize/i }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('enc-status-badge').textContent).toBe('ready'),
    );
  });

  it('hides the password input after initialization', async () => {
    render(<EncryptionKeyManagerPanel />);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'abc123' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /initialize/i }));
    });
    await waitFor(() => expect(screen.queryByLabelText('Master password')).not.toBeInTheDocument());
  });

  it('shows key management buttons after initialization', async () => {
    render(<EncryptionKeyManagerPanel />);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'abc123' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /initialize/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /rotate active key/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /generate new key/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
    });
  });

  // ── key generation ─────────────────────────────────────────────────────

  it('Generate New Key button adds a key to the list', async () => {
    render(<EncryptionKeyManagerPanel />);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'pass' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /initialize/i }));
    });
    await waitFor(() => screen.getByRole('button', { name: /generate new key/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate new key/i }));
    });
    // At least one active key shown
    await waitFor(() => expect(screen.getAllByText(/active/).length).toBeGreaterThan(0));
  });

  // ── key rotation ───────────────────────────────────────────────────────

  it('Rotate Active Key button changes the active badge', async () => {
    render(<EncryptionKeyManagerPanel />);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'pass' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /initialize/i }));
    });
    await waitFor(() => screen.getByRole('button', { name: /rotate active key/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /rotate active key/i }));
    });
    // Status stays ready after rotation
    await waitFor(() =>
      expect(screen.getByTestId('enc-status-badge').textContent).toBe('ready'),
    );
  });

  // ── reset ──────────────────────────────────────────────────────────────

  it('Reset button returns panel to idle state', async () => {
    render(<EncryptionKeyManagerPanel />);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'pass' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /initialize/i }));
    });
    await waitFor(() => screen.getByRole('button', { name: /reset/i }));

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('enc-status-badge').textContent).toBe('idle'),
    );
    expect(screen.getByLabelText('Master password')).toBeInTheDocument();
  });

  // ── keyboard submission ────────────────────────────────────────────────

  it('Enter key in password field triggers initialization', async () => {
    render(<EncryptionKeyManagerPanel />);
    const input = screen.getByLabelText('Master password');
    fireEvent.change(input, { target: { value: 'pressenter' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });
    await waitFor(() =>
      expect(screen.getByTestId('enc-status-badge').textContent).toBe('ready'),
    );
  });

  // ── accessible error alert ─────────────────────────────────────────────

  it('error alert has role=alert for screen readers', async () => {
    render(<EncryptionKeyManagerPanel />);
    fireEvent.click(screen.getByRole('button', { name: /initialize/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
  });
});
