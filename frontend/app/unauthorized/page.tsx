/**
 * Unauthorized Access Page
 * Shown when user doesn't have required permissions
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useI18n';

export default function UnauthorizedPage() {
  const { user } = useAuth();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-neutral-900 mb-4">
          {t('unauthorized.title', { defaultValue: 'Access Denied' })}
        </h1>

        <p className="text-neutral-600 mb-6">
          {t('unauthorized.message', {
            defaultValue: 'You don\'t have permission to access this page.'
          })}
        </p>

        {user && (
          <div className="bg-neutral-50 rounded p-4 mb-6 text-left">
            <p className="text-sm text-neutral-700 mb-2">
              <strong>{t('unauthorized.current_user', { defaultValue: 'Current user' })}:</strong> {user.name}
            </p>
            <p className="text-sm text-neutral-700 mb-2">
              <strong>{t('unauthorized.role', { defaultValue: 'Role' })}:</strong> {user.role}
            </p>
            <p className="text-sm text-neutral-700">
              <strong>{t('unauthorized.contact_admin', { defaultValue: 'Contact an administrator if you need access.' })}</strong>
            </p>
          </div>
        )}

        <div className="space-y-3">
          <Link
            href="/"
            className="block w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors"
          >
            {t('unauthorized.go_home', { defaultValue: 'Go to Home' })}
          </Link>

          {!user && (
            <Link
              href="/login"
              className="block w-full bg-neutral-600 text-white py-2 px-4 rounded hover:bg-neutral-700 transition-colors"
            >
              {t('unauthorized.login', { defaultValue: 'Login' })}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}