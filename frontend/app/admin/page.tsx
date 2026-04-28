/**
 * Admin Dashboard Page
 * Protected page for administrative functions
 */

'use client';

import React from 'react';
import { withRouteGuard } from '@/lib/routeGuards';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useI18n';

function AdminPage() {
  const { user } = useAuth();
  const { t } = useTranslation();

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-neutral-900 mb-8">
          {t('admin.title', { defaultValue: 'Admin Dashboard' })}
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* User Management Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-neutral-800 mb-4">
              {t('admin.users.title', { defaultValue: 'User Management' })}
            </h2>
            <p className="text-neutral-600 mb-4">
              {t('admin.users.description', { defaultValue: 'Manage user accounts and permissions' })}
            </p>
            <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors">
              {t('admin.users.manage', { defaultValue: 'Manage Users' })}
            </button>
          </div>

          {/* System Settings Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-neutral-800 mb-4">
              {t('admin.settings.title', { defaultValue: 'System Settings' })}
            </h2>
            <p className="text-neutral-600 mb-4">
              {t('admin.settings.description', { defaultValue: 'Configure system-wide settings' })}
            </p>
            <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors">
              {t('admin.settings.configure', { defaultValue: 'Configure' })}
            </button>
          </div>

          {/* System Health Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-neutral-800 mb-4">
              {t('admin.system.title', { defaultValue: 'System Health' })}
            </h2>
            <p className="text-neutral-600 mb-4">
              {t('admin.system.description', { defaultValue: 'Monitor system performance and health' })}
            </p>
            <button className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition-colors">
              {t('admin.system.monitor', { defaultValue: 'Monitor' })}
            </button>
          </div>
        </div>

        {/* Current User Info */}
        <div className="mt-8 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-neutral-800 mb-4">
            {t('admin.current_user', { defaultValue: 'Current User' })}
          </h2>
          <div className="space-y-2">
            <p><strong>{t('admin.user.name', { defaultValue: 'Name' })}:</strong> {user?.name}</p>
            <p><strong>{t('admin.user.address', { defaultValue: 'Address' })}:</strong> {user?.address}</p>
            <p><strong>{t('admin.user.role', { defaultValue: 'Role' })}:</strong> {user?.role}</p>
            <p><strong>{t('admin.user.permissions', { defaultValue: 'Permissions' })}:</strong></p>
            <ul className="list-disc list-inside ml-4">
              {user?.permissions.map(permission => (
                <li key={permission} className="text-sm text-neutral-600">{permission}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withRouteGuard(AdminPage, ['admin:users'], {
  redirectTo: '/unauthorized',
  requireAll: false, // User needs any admin permission
});