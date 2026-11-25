/**
 * Tests for GasVaultManager.
 *
 * Covers the three behaviours the issue calls for: a runway progress bar, low
 * balances escalating to red, and an alert once runway falls below the
 * threshold — plus the store actions that feed it.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GasVaultManager } from '../GasVaultManager';
import { useGasOptimizationStore } from '@/src/store/gasOptimizationStore';
import type { VaultSample } from '@/src/lib/gas/vault';

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

/** Build a linearly burning history so the burn-rate fit has a known answer. */
function burningHistory(balance: number, burnPerHour: number, hours = 12): VaultSample[] {
  const samples: VaultSample[] = [];
  for (let h = 0; h <= hours; h += 1) {
    samples.push({ timestamp: NOW - (hours - h) * HOUR, balanceXlm: Math.max(0, balance - burnPerHour * h) });
  }
  return samples;
}

function seed(samples: VaultSample[], balance: number) {
  const state = useGasOptimizationStore.getState();
  state.resetAlert();
  useGasOptimizationStore.setState({
    vaultSamples: samples,
    vaultBalanceXlm: balance,
    lastAlertedHours: null,
    notificationPermission: 'default',
    notificationsEnabled: false,
  });
}

beforeEach(() => {
  seed([], 0);
});

describe('GasVaultManager', () => {
  it('renders the heading and current balance', () => {
    seed(burningHistory(100, 0.5), 100);
    render(<GasVaultManager />);
    expect(screen.getByRole('heading', { name: /gas vault manager/i })).toBeInTheDocument();
    expect(screen.getByTestId('gas-vault-balance')).toHaveTextContent('100.0000 XLM');
  });

  it('exposes the runway as a labelled progressbar', () => {
    seed(burningHistory(100, 0.5), 100);
    render(<GasVaultManager />);
    const bar = screen.getByRole('progressbar', { name: /gas vault runway/i });
    expect(bar).toBeInTheDocument();
    // Runway of 100 XLM at 0.5 XLM/h is 200h, clamped against the 48h max.
    expect(Number(bar.getAttribute('aria-valuemax'))).toBe(48);
    expect(bar).toHaveAttribute('aria-valuenow');
  });

  it('shows the projected runway', () => {
    seed(burningHistory(100, 0.5), 100);
    render(<GasVaultManager />);
    // 100 XLM burning at 0.5/h is 200h = 8d 8h.
    expect(screen.getByTestId('gas-vault-runway')).toHaveTextContent('8d 8h');
  });

  it('reports a healthy vault when runway is comfortable', () => {
    seed(burningHistory(1_000, 0.5), 1_000);
    render(<GasVaultManager />);
    expect(screen.getByTestId('gas-vault-severity')).toHaveTextContent('Healthy');
    expect(screen.queryByTestId('gas-vault-warning')).not.toBeInTheDocument();
  });

  it('escalates to a warning with a top-up prompt below the threshold', () => {
    // 10 XLM at 0.5/h is 20h of runway — under the 48h alert threshold.
    seed(burningHistory(10, 0.5), 10);
    render(<GasVaultManager />);
    expect(screen.getByTestId('gas-vault-severity')).toHaveTextContent('Running low');
    const warning = screen.getByTestId('gas-vault-warning');
    expect(warning).toBeInTheDocument();
    // 48h at 0.5/h = 24 XLM needed, 10 held, so 14 short.
    expect(warning).toHaveTextContent('14.0000 XLM');
  });

  it('escalates to critical in the last quarter of the threshold', () => {
    // 5 XLM at 0.5/h is 10h, under 48/4 = 12h.
    seed(burningHistory(5, 0.5), 5);
    render(<GasVaultManager />);
    expect(screen.getByTestId('gas-vault-severity')).toHaveTextContent('Critical');
  });

  it('announces the runway politely to assistive technology', () => {
    seed(burningHistory(10, 0.5), 10);
    render(<GasVaultManager />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/gas vault runway/i);
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('warns when the balance history is too noisy to trust', () => {
    seed(
      [
        { timestamp: NOW - 3 * HOUR, balanceXlm: 10 },
        { timestamp: NOW - 2 * HOUR, balanceXlm: 1 },
        { timestamp: NOW - HOUR, balanceXlm: 10 },
        { timestamp: NOW, balanceXlm: 1 },
      ],
      1,
    );
    render(<GasVaultManager />);
    expect(screen.getByRole('note')).toHaveTextContent(/noisy/i);
  });

  it('does not fire notifications when they are not enabled', () => {
    const notify = jest.fn();
    (global as unknown as { Notification: unknown }).Notification = notify;
    seed(burningHistory(10, 0.5), 10);
    useGasOptimizationStore.setState({
      notificationsEnabled: true,
      notificationPermission: 'denied',
    });
    render(<GasVaultManager />);
    expect(notify).not.toHaveBeenCalled();
  });

  it('fires a notification once when permission is granted and runway is low', async () => {
    const notify = jest.fn();
    (global as unknown as { Notification: unknown }).Notification = notify;
    seed(burningHistory(10, 0.5), 10);
    useGasOptimizationStore.setState({
      notificationsEnabled: true,
      notificationPermission: 'granted',
    });
    render(<GasVaultManager />);
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0][1].body).toMatch(/run time left/i);
  });

  it('does not re-notify for the same runway', async () => {
    const notify = jest.fn();
    (global as unknown as { Notification: unknown }).Notification = notify;
    seed(burningHistory(10, 0.5), 10);
    useGasOptimizationStore.setState({
      notificationsEnabled: true,
      notificationPermission: 'granted',
      lastAlertedHours: 20,
    });
    render(<GasVaultManager />);
    await waitFor(() => expect(notify).not.toHaveBeenCalled());
  });

  it('reports unsupported notifications after an enable attempt', async () => {
    (global as unknown as { Notification?: unknown }).Notification = undefined;
    render(<GasVaultManager />);
    const button = screen.getByRole('button', { name: /enable/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
  });

  it('polls the balance when a fetcher is supplied', async () => {
    const fetchBalance = jest.fn().mockResolvedValue(42);
    render(<GasVaultManager fetchBalance={fetchBalance} pollMs={0} />);
    await waitFor(() => expect(fetchBalance).toHaveBeenCalled());
    await waitFor(() =>
      expect(useGasOptimizationStore.getState().vaultBalanceXlm).toBe(42),
    );
  });

  it('keeps the last known runway when a poll fails', async () => {
    const fetchBalance = jest.fn().mockRejectedValue(new Error('rpc down'));
    render(<GasVaultManager fetchBalance={fetchBalance} pollMs={0} />);
    await waitFor(() => expect(fetchBalance).toHaveBeenCalled());
    // The failure must not wipe the observations the forecast depends on.
    expect(useGasOptimizationStore.getState().vaultSamples).toHaveLength(0);
  });
});

describe('gasOptimizationStore vault actions', () => {
  const store = () => useGasOptimizationStore.getState();

  beforeEach(() => {
    store().resetAlert();
  });

  it('records balance observations', () => {
    store().recordVaultBalance(10, NOW);
    store().recordVaultBalance(9, NOW + 1000);
    expect(store().vaultBalanceXlm).toBe(9);
    expect(store().vaultSamples).toHaveLength(2);
  });

  it('ignores a non-positive balance', () => {
    store().recordVaultBalance(5, NOW);
    store().recordVaultBalance(-1, NOW + 1);
    expect(store().vaultBalanceXlm).toBe(5);
  });

  it('ignores a non-finite balance', () => {
    store().recordVaultBalance(5, NOW);
    store().recordVaultBalance(Number.NaN, NOW + 1);
    expect(store().vaultBalanceXlm).toBe(5);
  });

  it('tops up and clears the alert latch', () => {
    store().recordVaultBalance(5, NOW);
    store().markAlerted(3);
    expect(store().lastAlertedHours).toBe(3);
    store().topUpVault(10);
    expect(store().vaultBalanceXlm).toBe(15);
    expect(store().lastAlertedHours).toBeNull();
  });

  it('ignores a non-positive top-up', () => {
    store().recordVaultBalance(5, NOW);
    store().topUpVault(0);
    store().topUpVault(-5);
    expect(store().vaultBalanceXlm).toBe(5);
  });

  it('records a top-up as an observation', () => {
    store().recordVaultBalance(5, NOW);
    store().topUpVault(5);
    expect(store().vaultSamples).toHaveLength(2);
  });

  it('prunes old samples but keeps the latest', () => {
    store().recordVaultBalance(10, NOW - 10 * HOUR);
    store().recordVaultBalance(9, NOW - 9 * HOUR);
    store().recordVaultBalance(8, NOW);
    store().pruneVaultSamples(HOUR, NOW);
    const samples = store().vaultSamples;
    expect(samples).toHaveLength(1);
    expect(samples[0].timestamp).toBe(NOW);
  });

  it('keeps samples that are still inside the window', () => {
    store().recordVaultBalance(10, NOW - HOUR);
    store().recordVaultBalance(9, NOW);
    store().pruneVaultSamples(2 * HOUR, NOW);
    expect(store().vaultSamples).toHaveLength(2);
  });

  it('bounds the sample history', () => {
    for (let i = 0; i < 600; i += 1) {
      store().recordVaultBalance(100 - i, NOW + i);
    }
    expect(store().vaultSamples.length).toBeLessThanOrEqual(500);
  });

  it('validates the alert threshold', () => {
    store().setAlertThresholdHours(24);
    expect(store().alertThresholdHours).toBe(24);
    store().setAlertThresholdHours(0);
    store().setAlertThresholdHours(Number.NaN);
    expect(store().alertThresholdHours).toBe(24);
  });

  it('resets the alert latch when the threshold changes', () => {
    store().markAlerted(5);
    store().setAlertThresholdHours(72);
    expect(store().lastAlertedHours).toBeNull();
  });

  it('ignores an invalid alerted runway', () => {
    store().markAlerted(-1);
    expect(store().lastAlertedHours).toBeNull();
  });

  it('defaults the threshold to 48 hours', () => {
    useGasOptimizationStore.setState({ alertThresholdHours: 48 });
    expect(store().alertThresholdHours).toBe(48);
  });

  it('tracks notification preference and permission', () => {
    store().setNotificationsEnabled(true);
    store().setNotificationPermission('granted');
    expect(store().notificationsEnabled).toBe(true);
    expect(store().notificationPermission).toBe('granted');
  });

  it('leaves the pre-existing optimisation state intact', () => {
    expect(store().feeTiers.length).toBeGreaterThan(0);
    expect(typeof store().refreshMetrics).toBe('function');
    expect(typeof store().runSimulation).toBe('function');
    expect(typeof store().applyBatching).toBe('function');
  });
});
