/**
 * Login Page
 * Comprehensive Wallet Onboarding & Auto-Reconnection Flow (Freighter, xBull, Lobstr, Hana, WalletConnect v2)
 * Issue #1476.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useI18n';
import { useWebAuthn } from '@/hooks/useWebAuthn';
import { useWallet, type SupportedWallet } from '@/src/context/WalletContext';

export default function LoginPage() {
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [enrollSuccessMessage, setEnrollSuccessMessage] = useState<string | null>(null);
  const { login, isLoading: isAuthLoading, error: authError } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  // Multi-wallet universal connector & auto-reconnect context
  const {
    session: walletSession,
    status: walletStatus,
    activeWallet,
    installedWallets,
    isWrongNetwork,
    networkWarning,
    connectWith,
    disconnect: disconnectWalletSession,
    isLoading: isWalletLoading,
    errorMessage: walletErrorMessage,
  } = useWallet();

  const {
    isSupported: isWebAuthnSupported,
    isPlatformAvailable: isBiometricsAvailable,
    isEnrolled: isDeviceEnrolled,
    isLoading: isWebAuthnLoading,
    error: webAuthnError,
    enrollDevice,
    authenticateDevice,
  } = useWebAuthn();

  const mockUsers = [
    {
      id: 'admin',
      name: 'Admin User',
      address: 'admin_address',
      role: 'admin',
      description: 'Full system access',
    },
    {
      id: 'user',
      name: 'Regular User',
      address: 'user_address',
      role: 'user',
      description: 'Can manage own tasks',
    },
    {
      id: 'viewer',
      name: 'Viewer User',
      address: 'viewer_address',
      role: 'viewer',
      description: 'Read-only access',
    },
  ];

  const handleLogin = async () => {
    if (!selectedUser) return;

    try {
      const userData = mockUsers.find((u) => u.id === selectedUser);
      if (!userData) return;

      await login({
        id: userData.id,
        address: userData.address,
        role: userData.role as any,
        permissions: [],
        name: userData.name,
      });

      router.push('/');
    } catch (_err) {
      // Error is handled by AuthContext
    }
  };

  const handleWalletLogin = async () => {
    if (!walletSession?.address) return;
    try {
      await login({
        id: walletSession.address,
        address: walletSession.address,
        role: 'user' as any,
        permissions: [],
        name: `Stellar (${activeWallet || 'Wallet'})`,
      });
      router.push('/');
    } catch (_err) {
      // Error handled by AuthContext
    }
  };

  const handleBiometricsLogin = async () => {
    try {
      const result = await authenticateDevice();
      if (result) {
        const userData = mockUsers.find((u) => u.address === result.userAddress);
        if (userData) {
          await login({
            id: userData.id,
            address: userData.address,
            role: userData.role as any,
            permissions: [],
            name: userData.name,
          });
          router.push('/');
        } else {
          await login({
            id: 'user',
            address: result.userAddress,
            role: 'user',
            permissions: [],
            name: 'WebAuthn User',
          });
          router.push('/');
        }
      }
    } catch (_err) {
      // Handled
    }
  };

  const handleEnrollDevice = async () => {
    if (!selectedUser) return;
    const userData = mockUsers.find((u) => u.id === selectedUser);
    if (!userData) return;

    setEnrollSuccessMessage(null);
    try {
      await enrollDevice(userData.address, userData.name);
      setEnrollSuccessMessage('Device biometrics (Secure Enclave) registered successfully!');
    } catch (_err) {
      // Handled
    }
  };

  const activeError = authError || webAuthnError || walletErrorMessage;

  const supportedWalletsList: Array<{
    id: SupportedWallet;
    name: string;
    icon: string;
    tag: string;
  }> = [
    { id: 'freighter', name: 'Freighter', icon: '🦊', tag: 'Browser Extension' },
    { id: 'xbull', name: 'xBull', icon: '🐂', tag: 'Extension & Web' },
    { id: 'lobstr', name: 'LOBSTR', icon: '🌟', tag: 'Mobile & Web' },
    { id: 'hana', name: 'Hana', icon: '🌸', tag: 'Browser Extension' },
    { id: 'walletconnect_v2', name: 'WalletConnect v2', icon: '📱', tag: 'Universal Mobile QR' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 px-4 py-8">
      <div className="max-w-lg w-full bg-slate-800/80 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-700 p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mb-2">
            {t('login.title', { defaultValue: 'Login to SoroTask' })}
          </h1>
          <p className="text-sm text-slate-400">
            {t('login.subtitle', { defaultValue: 'Connect your Stellar wallet or authenticate with Secure Enclave' })}
          </p>
        </div>

        {/* Global Error Banner */}
        {activeError && (
          <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-xl text-red-200 text-sm">
            {activeError}
          </div>
        )}

        {/* Network Switching Guard Banner */}
        {isWrongNetwork && networkWarning && (
          <div className="p-4 bg-amber-950/70 border border-amber-500/70 rounded-xl text-amber-200 text-xs space-y-1">
            <div className="font-bold flex items-center gap-1 text-amber-300">
              <span>⚠️</span> Network Warning
            </div>
            <div>{networkWarning}</div>
          </div>
        )}

        {/* Active Connected Wallet Card & Auto-Reconnect Session Banner */}
        {walletSession ? (
          <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-950/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-xs font-semibold uppercase text-emerald-300">
                  {walletStatus === 'restoring' ? 'Re-authenticating...' : 'Wallet Connected'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-900/60 text-emerald-200 font-mono">
                  {activeWallet}
                </span>
              </div>
              <button
                type="button"
                onClick={disconnectWalletSession}
                className="text-xs text-slate-400 hover:text-red-300 underline"
              >
                Disconnect
              </button>
            </div>
            <div className="text-xs font-mono text-slate-300 truncate">
              {walletSession.address}
            </div>
            <button
              type="button"
              onClick={handleWalletLogin}
              className="w-full py-2.5 px-4 rounded-xl font-semibold bg-emerald-600 hover:bg-emerald-500 text-white text-sm transition shadow-lg shadow-emerald-600/20"
            >
              Sign In with Connected Wallet
            </button>
          </div>
        ) : (
          /* Universal Stellar Multi-Wallet Onboarding */
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>Connect Stellar Wallet</span>
              <span className="text-[11px] text-slate-500 font-normal">Auto-reconnects on refresh</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {supportedWalletsList.map((w) => {
                const isInstalled = installedWallets[w.id];
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => connectWith(w.id)}
                    disabled={isWalletLoading}
                    className="flex items-center justify-between p-3 rounded-xl border border-slate-700 bg-slate-850 hover:bg-slate-700/60 hover:border-slate-500 transition text-left group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{w.icon}</span>
                      <div>
                        <div className="text-sm font-semibold text-slate-200 group-hover:text-white flex items-center gap-1.5">
                          {w.name}
                          {isInstalled && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                              title="Detected in browser"
                            ></span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {isInstalled ? 'Installed' : w.tag}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-blue-400 font-medium group-hover:translate-x-0.5 transition-transform">
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-slate-700"></div>
          <span className="flex-shrink mx-4 text-slate-500 text-xs uppercase tracking-wider">
            or standard mock credentials
          </span>
          <div className="flex-grow border-t border-slate-700"></div>
        </div>

        {enrollSuccessMessage && (
          <div className="p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-xl text-emerald-200 text-xs">
            {enrollSuccessMessage}
          </div>
        )}

        {/* Biometrics Direct Sign In Option */}
        {isWebAuthnSupported && isBiometricsAvailable && isDeviceEnrolled && (
          <button
            onClick={handleBiometricsLogin}
            disabled={isWebAuthnLoading || isAuthLoading}
            className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-500 to-blue-600 text-white font-semibold py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-500/20 hover:from-indigo-600 hover:to-blue-700 disabled:opacity-50 transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11a5 5 0 00-10 0c0 1.02.166 2.001.472 2.922m8.055-4.076a10.45 10.45 0 011.884-5.185m2 10.45a9 9 0 01-11.885-3.353m12.43-1.622a12.454 12.454 0 00-1.121-7.2m0 0a12.454 12.454 0 00-9.623-4.814" />
            </svg>
            {isWebAuthnLoading ? 'Verifying biometrics...' : 'Sign in with Biometrics'}
          </button>
        )}

        {/* Mock Role Selectors */}
        <div className="space-y-2">
          {mockUsers.map((user) => (
            <label
              key={user.id}
              className={`block p-3 border rounded-xl cursor-pointer transition ${
                selectedUser === user.id
                  ? 'border-blue-500 bg-blue-950/30'
                  : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="user"
                value={user.id}
                checked={selectedUser === user.id}
                onChange={(e) => {
                  setSelectedUser(e.target.value);
                  setEnrollSuccessMessage(null);
                }}
                className="sr-only"
              />
              <div className="flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-slate-200">{user.name}</div>
                  <div className="text-slate-400">{user.description}</div>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border-2 ${
                    selectedUser === user.id ? 'border-blue-500 bg-blue-500' : 'border-slate-600'
                  }`}
                />
              </div>
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={handleLogin}
            disabled={!selectedUser || isAuthLoading || isWebAuthnLoading}
            className="w-full bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold py-2 px-4 rounded-xl disabled:opacity-50 transition text-sm"
          >
            {isAuthLoading ? 'Signing in...' : t('login.sign_in', { defaultValue: 'Sign In (Selected Role)' })}
          </button>

          {isWebAuthnSupported && isBiometricsAvailable && selectedUser && (
            <button
              onClick={handleEnrollDevice}
              disabled={isWebAuthnLoading || isAuthLoading}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-600 hover:border-indigo-500 text-slate-300 font-medium py-1.5 px-3 rounded-xl text-xs transition"
            >
              Register Device Biometrics for {mockUsers.find((u) => u.id === selectedUser)?.name}
            </button>
          )}
        </div>

        <div className="text-center text-[11px] text-slate-500">
          SoroTask Multi-Wallet Onboarding & Secure Authentication Portal
        </div>
      </div>
    </div>
  );
}
