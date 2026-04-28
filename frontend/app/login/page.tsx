/**
 * Login Page
 * Mock login interface for demonstration
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useI18n';

export default function LoginPage() {
  const [selectedUser, setSelectedUser] = useState<string>('');
  const { login, isLoading, error } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  const mockUsers = [
    {
      id: 'admin',
      name: 'Admin User',
      address: 'admin_address',
      role: 'admin',
      description: 'Full system access'
    },
    {
      id: 'user',
      name: 'Regular User',
      address: 'user_address',
      role: 'user',
      description: 'Can manage own tasks'
    },
    {
      id: 'viewer',
      name: 'Viewer User',
      address: 'viewer_address',
      role: 'viewer',
      description: 'Read-only access'
    }
  ];

  const handleLogin = async () => {
    if (!selectedUser) return;

    try {
      const userData = mockUsers.find(u => u.id === selectedUser);
      if (!userData) return;

      await login({
        id: userData.id,
        address: userData.address,
        role: userData.role as any,
        permissions: [], // Will be set by AuthService
        name: userData.name,
      });

      router.push('/');
    } catch (err) {
      // Error is handled by AuthContext
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">
            {t('login.title', { defaultValue: 'Login to SoroTask' })}
          </h1>
          <p className="text-neutral-600">
            {t('login.subtitle', { defaultValue: 'Select a user to continue' })}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-4 mb-6">
          {mockUsers.map((user) => (
            <label
              key={user.id}
              className={`block p-4 border rounded-lg cursor-pointer transition-colors ${
                selectedUser === user.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-neutral-200 hover:border-neutral-300'
              }`}
            >
              <input
                type="radio"
                name="user"
                value={user.id}
                checked={selectedUser === user.id}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="sr-only"
              />
              <div className="flex items-center">
                <div className="flex-1">
                  <div className="font-medium text-neutral-900">{user.name}</div>
                  <div className="text-sm text-neutral-600">{user.description}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Role: {user.role} | Address: {user.address}
                  </div>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 ${
                  selectedUser === user.id
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-neutral-300'
                }`}>
                  {selectedUser === user.id && (
                    <div className="w-2 h-2 bg-white rounded-full m-0.5"></div>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>

        <button
          onClick={handleLogin}
          disabled={!selectedUser || isLoading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {t('login.signing_in', { defaultValue: 'Signing in...' })}
            </span>
          ) : (
            t('login.sign_in', { defaultValue: 'Sign In' })
          )}
        </button>

        <div className="mt-6 text-center text-sm text-neutral-600">
          {t('login.demo_note', {
            defaultValue: 'This is a demo login. In production, this would connect to your Stellar wallet.'
          })}
        </div>
      </div>
    </div>
  );
}