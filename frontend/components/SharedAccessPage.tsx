'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AccessValidationResult, SharedAccess } from '@/types/sharing';

interface SharedAccessPageProps {
  shareToken: string;
  onValidateAccess: (token: string, password?: string) => Promise<AccessValidationResult>;
}

export function SharedAccessPage({ shareToken, onValidateAccess }: SharedAccessPageProps) {
  const [validation, setValidation] = useState<AccessValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateAccess = useCallback(async (pwd?: string) => {
    setIsSubmitting(true);
    setPasswordError(null);
    try {
      const result = await onValidateAccess(shareToken, pwd);
      setValidation(result);
      if (result.reason === 'password_required') {
        // Keep showing password form
      } else if (!result.valid && result.reason === 'invalid_token') {
        setPasswordError('Incorrect password');
      }
    } catch {
      setValidation({ valid: false, reason: 'not_found' });
    } finally {
      setIsSubmitting(false);
      setIsLoading(false);
    }
  }, [shareToken, onValidateAccess]);

  useEffect(() => {
    validateAccess();
  }, [validateAccess]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    validateAccess(password);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-900 text-neutral-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-neutral-400">Validating access...</p>
        </div>
      </div>
    );
  }

  // Invalid/expired/revoked states
  if (!validation?.valid) {
    const reason = validation?.reason || 'not_found';
    const errorContent = {
      expired: {
        icon: (
          <svg className="w-12 h-12 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        title: 'Link Expired',
        message: 'This share link has expired and is no longer accessible.',
      },
      revoked: {
        icon: (
          <svg className="w-12 h-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        ),
        title: 'Access Revoked',
        message: 'The owner has revoked access to this shared content.',
      },
      not_found: {
        icon: (
          <svg className="w-12 h-12 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        title: 'Link Not Found',
        message: 'This share link does not exist or has been removed.',
      },
      invalid_token: {
        icon: (
          <svg className="w-12 h-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        ),
        title: 'Access Denied',
        message: 'You do not have permission to view this content.',
      },
      password_required: {
        icon: (
          <svg className="w-12 h-12 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        ),
        title: 'Password Required',
        message: 'This shared content is password protected.',
      },
    };

    const error = errorContent[reason];

    // Password required - show form
    if (reason === 'password_required') {
      return (
        <div className="min-h-screen bg-neutral-900 text-neutral-100 flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-8 text-center">
              <div className="flex justify-center mb-4">{error.icon}</div>
              <h1 className="text-xl font-bold mb-2">{error.title}</h1>
              <p className="text-neutral-400 mb-6">{error.message}</p>

              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    autoFocus
                  />
                  {passwordError && (
                    <p className="text-red-400 text-sm mt-2">{passwordError}</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={!password || isSubmitting}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Verifying...' : 'Access Content'}
                </button>
              </form>
            </div>
          </div>
        </div>
      );
    }

    // Other error states
    return (
      <div className="min-h-screen bg-neutral-900 text-neutral-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-8 text-center">
            <div className="flex justify-center mb-4">{error.icon}</div>
            <h1 className="text-xl font-bold mb-2">{error.title}</h1>
            <p className="text-neutral-400">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  // Valid access - render shared content
  const share = validation.share!;
  const isExpired = share.status === 'expired';
  const isRevoked = share.status === 'revoked';

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100">
      {/* Warning banner for expired/revoked */}
      {(isExpired || isRevoked) && (
        <div className={`border-b px-4 py-3 text-sm ${
          isExpired ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          <div className="container mx-auto flex items-center gap-2">
            {isExpired ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>This share link has expired. Some information may be outdated.</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <span>Access to this content has been revoked.</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">S</div>
          <span className="text-neutral-400">Shared {share.scope === 'task' ? 'Task' : 'Project'}</span>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 shadow-xl">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold mb-1">{share.resourceName}</h1>
              <div className="flex items-center gap-3 text-sm text-neutral-400">
                <span className="capitalize">{share.scope}</span>
                <span>•</span>
                <span className="capitalize">{share.visibility.replace('_', ' ')}</span>
                {share.expiresAt && (
                  <>
                    <span>•</span>
                    <span>Expires: {new Date(share.expiresAt).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            </div>
            {share.status === 'active' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                Active
              </span>
            )}
          </div>

          {/* Shared content placeholder - would be replaced with actual content */}
          <div className="border-t border-neutral-700/50 pt-4 mt-4">
            <p className="text-neutral-400 text-sm">
              This is a shared {share.scope}. The actual content would be displayed here based on the shared fields configuration.
            </p>
          </div>
        </div>

        {/* Access info */}
        <div className="mt-4 text-xs text-neutral-500 text-center">
          Shared on {new Date(share.createdAt).toLocaleDateString()}
          {share.accessCount > 0 && (
            <span className="ml-2">• Accessed {share.accessCount} time{share.accessCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </main>
    </div>
  );
}
