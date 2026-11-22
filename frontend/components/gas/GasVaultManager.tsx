/**
 * Gas Vault Manager Component
 *
 * Autonomous gas vault monitor: shows remaining runway as a progress bar,
 * estimates the burn rate, forecasts time-to-depletion, and raises a browser
 * notification when the vault drops below a configurable threshold of run time.
 *
 * The depletion estimate comes from a least-squares fit over the observed
 * balance history rather than a difference between the last two readings, so a
 * single slow block does not read as a collapse in burn rate.
 */

'use client';

import React, { useCallback, useEffect, useMemo } from 'react';
import { useGasOptimizationStore } from '@/src/store/gasOptimizationStore';
import {
  classifyVault,
  estimateBurnRate,
  forecastDepletion,
  formatRunway,
  shouldAlert,
  topUpRequired,
  type VaultSeverity,
} from '@/src/lib/gas/vault';

interface GasVaultManagerProps {
  /** Polling interval for the balance in ms. 0 disables polling. */
  pollMs?: number;
  /** Fetcher used when the caller wants a live balance source. */
  fetchBalance?: () => Promise<number>;
  className?: string;
}

const SEVERITY_STYLES: Record<VaultSeverity, { bar: string; text: string; label: string }> = {
  healthy: { bar: 'bg-green-500', text: 'text-green-700', label: 'Healthy' },
  warning: { bar: 'bg-yellow-500', text: 'text-yellow-700', label: 'Running low' },
  critical: { bar: 'bg-red-500', text: 'text-red-700', label: 'Critical' },
  exhausted: { bar: 'bg-red-700', text: 'text-red-700', label: 'Exhausted' },
};

const formatXlm = (value: number) => value.toFixed(4);

export function GasVaultManager({
  pollMs = 60_000,
  fetchBalance,
  className = '',
}: GasVaultManagerProps) {
  const balance = useGasOptimizationStore((s) => s.vaultBalanceXlm);
  const samples = useGasOptimizationStore((s) => s.vaultSamples);
  const thresholdHours = useGasOptimizationStore((s) => s.alertThresholdHours);
  const notificationsEnabled = useGasOptimizationStore((s) => s.notificationsEnabled);
  const notificationPermission = useGasOptimizationStore((s) => s.notificationPermission);
  const lastAlertedHours = useGasOptimizationStore((s) => s.lastAlertedHours);
  const recordVaultBalance = useGasOptimizationStore((s) => s.recordVaultBalance);
  const setNotificationsEnabled = useGasOptimizationStore((s) => s.setNotificationsEnabled);
  const setNotificationPermission = useGasOptimizationStore((s) => s.setNotificationPermission);
  const markAlerted = useGasOptimizationStore((s) => s.markAlerted);

  const estimate = useMemo(() => estimateBurnRate(samples), [samples]);
  const forecast = useMemo(
    () => forecastDepletion(balance, estimate, Date.now()),
    [balance, estimate],
  );
  const severity = useMemo(
    () => classifyVault(forecast, thresholdHours),
    [forecast, thresholdHours],
  );

  const runwayShare =
    forecast.hoursRemaining === null
      ? 1
      : Math.max(0, Math.min(1, forecast.hoursRemaining / thresholdHours));
  const topUp = useMemo(
    () => topUpRequired(balance, estimate, thresholdHours),
    [balance, estimate, thresholdHours],
  );

  /**
   * Request notification permission lazily, on the user gesture that enables
   * notifications — browsers reject a permission prompt that was not user
   * initiated, so asking on mount would always fail.
   */
  const enableNotifications = useCallback(async () => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      setNotificationPermission('unsupported');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotificationPermission(result);
      setNotificationsEnabled(result === 'granted');
    } catch {
      setNotificationPermission('denied');
      setNotificationsEnabled(false);
    }
  }, [setNotificationPermission, setNotificationsEnabled]);

  useEffect(() => {
    if (!fetchBalance) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await fetchBalance();
        if (!cancelled) recordVaultBalance(next);
      } catch {
        // A failed balance poll leaves the previous observation in place, so
        // the forecast degrades to the last known runway rather than blanking.
      }
    };

    void poll();
    if (pollMs > 0) {
      const id = setInterval(() => void poll(), pollMs);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [fetchBalance, pollMs, recordVaultBalance]);

  // Fire the low-balance alert once per meaningful drop. The latch lives in the
  // store so a re-render cannot turn one low reading into a burst of toasts.
  useEffect(() => {
    if (!notificationsEnabled || notificationPermission !== 'granted') return;
    if (!shouldAlert(forecast, thresholdHours, lastAlertedHours)) return;
    if (typeof Notification === 'undefined') return;

    try {
      new Notification('SoroTask gas vault running low', {
        body:
          forecast.hoursRemaining === null
            ? 'Vault runway is below the alert threshold.'
            : `About ${formatRunway(forecast.hoursRemaining)} of run time left. Top up ${topUp.toFixed(4)} XLM to restore ${thresholdHours}h.`,
      });
    } catch {
      // Some browsers throw for constructor-based notifications outside a
      // service worker; the in-page banner is the fallback.
    }
    markAlerted(forecast.hoursRemaining ?? 0);
  }, [
    notificationsEnabled,
    notificationPermission,
    forecast,
    thresholdHours,
    lastAlertedHours,
    topUp,
    markAlerted,
  ]);

  const styles = SEVERITY_STYLES[severity];

  return (
    <div
      className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 ${className}`}
      role="group"
      aria-labelledby="gas-vault-manager-title"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 id="gas-vault-manager-title" className="text-lg font-semibold text-gray-900">
          Gas Vault Manager
        </h3>
        <span
          className={`px-3 py-1 rounded-full text-sm font-medium ${styles.text}`}
          data-testid="gas-vault-severity"
        >
          {styles.label}
        </span>
      </div>

      {/* Announced politely so a screen reader hears the runway change when a
          balance poll updates it, rather than only on user action. */}
      <p className="sr-only" role="status" aria-live="polite">
        Gas vault runway {formatRunway(forecast.hoursRemaining)}, status {styles.label}.
      </p>

      <div
        className="w-full h-4 bg-gray-200 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={thresholdHours}
        aria-valuenow={Number(forecast.hoursRemaining?.toFixed(1) ?? thresholdHours)}
        aria-valuetext={`${formatRunway(forecast.hoursRemaining)} of run time remaining`}
        aria-label="Gas vault runway"
      >
        <div
          className={`h-full ${styles.bar} transition-all duration-500`}
          style={{ width: `${runwayShare * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mt-5">
        <div>
          <span className="block text-sm text-gray-600">Balance</span>
          <span className="block text-xl font-bold text-gray-900" data-testid="gas-vault-balance">
            {formatXlm(balance)} XLM
          </span>
        </div>
        <div>
          <span className="block text-sm text-gray-600">Runway</span>
          <span className="block text-xl font-bold text-gray-900" data-testid="gas-vault-runway">
            {formatRunway(forecast.hoursRemaining)}
          </span>
        </div>
        <div>
          <span className="block text-sm text-gray-600">Burn rate</span>
          <span className="block text-lg font-semibold text-gray-900">
            {forecast.burnRatePerHour.toFixed(4)} XLM/h
          </span>
        </div>
        <div>
          <span className="block text-sm text-gray-600">Alert threshold</span>
          <span className="block text-lg font-semibold text-gray-900">{thresholdHours}h</span>
        </div>
      </div>

      {forecast.unreliable && forecast.willDeplete && (
        <p className="mt-3 text-sm text-yellow-700" role="note">
          Balance history is noisy — treat this estimate as approximate.
        </p>
      )}

      {severity === 'warning' || severity === 'critical' || severity === 'exhausted' ? (
        <div
          className="mt-4 p-3 rounded-md bg-red-50 border border-red-200"
          role="alert"
          data-testid="gas-vault-warning"
        >
          <p className="text-sm text-red-800">
            Deposit {topUp.toFixed(4)} XLM to restore {thresholdHours} hours of run time.
          </p>
        </div>
      ) : null}

      <div className="mt-5 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Browser notifications</span>
          <button
            type="button"
            onClick={() => void enableNotifications()}
            disabled={notificationPermission === 'unsupported'}
            className="px-3 py-1 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {notificationsEnabled ? 'Enabled' : 'Enable'}
          </button>
        </div>
        {notificationPermission === 'unsupported' && (
          <p className="mt-2 text-xs text-gray-500">
            This browser does not support notifications.
          </p>
        )}
        {notificationPermission === 'denied' && (
          <p className="mt-2 text-xs text-gray-500">
            Notifications are blocked in your browser settings.
          </p>
        )}
      </div>
    </div>
  );
}

export default GasVaultManager;
