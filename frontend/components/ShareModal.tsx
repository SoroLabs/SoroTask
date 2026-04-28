'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ShareScope, ShareVisibility, SharedAccess, SharePreview, CreateShareRequest } from '@/types/sharing';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  scope: ShareScope;
  resourceId: string;
  resourceName: string;
  onCreateShare: (request: CreateShareRequest) => Promise<SharedAccess>;
  onRevokeShare: (shareId: string) => Promise<void>;
  existingShares: SharedAccess[];
  preview?: SharePreview;
}

type ModalStep = 'preview' | 'configure' | 'success' | 'manage';

const VISIBILITY_OPTIONS: { value: ShareVisibility; label: string; description: string }[] = [
  { value: 'public', label: 'Public', description: 'Anyone with the link can view' },
  { value: 'private', label: 'Private', description: 'Only accessible with the share token' },
  { value: 'password_protected', label: 'Password Protected', description: 'Requires a password to access' },
];

const EXPIRATION_OPTIONS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: 'Never expires' },
  { value: 3600, label: '1 hour' },
  { value: 86400, label: '24 hours' },
  { value: 604800, label: '7 days' },
  { value: 2592000, label: '30 days' },
];

export function ShareModal({
  isOpen,
  onClose,
  scope,
  resourceId,
  resourceName,
  onCreateShare,
  onRevokeShare,
  existingShares,
  preview,
}: ShareModalProps) {
  const [step, setStep] = useState<ModalStep>(existingShares.length > 0 ? 'manage' : 'preview');
  const [visibility, setVisibility] = useState<ShareVisibility>('public');
  const [expiresIn, setExpiresIn] = useState<number | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isRevoking, setIsRevoking] = useState<string | null>(null);
  const [createdShare, setCreatedShare] = useState<SharedAccess | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(existingShares.length > 0 ? 'manage' : 'preview');
      setVisibility('public');
      setExpiresIn(undefined);
      setPassword('');
      setCreatedShare(null);
      setCopied(false);
      setError(null);
    }
  }, [isOpen, existingShares.length]);

  const handleCreateShare = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    try {
      const request: CreateShareRequest = {
        scope,
        resourceId,
        visibility,
        expiresIn,
        password: visibility === 'password_protected' ? password : undefined,
      };
      const share = await onCreateShare(request);
      setCreatedShare(share);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setIsCreating(false);
    }
  }, [scope, resourceId, visibility, expiresIn, password, onCreateShare]);

  const handleRevokeShare = useCallback(async (shareId: string) => {
    setIsRevoking(shareId);
    setError(null);
    try {
      await onRevokeShare(shareId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke share');
    } finally {
      setIsRevoking(null);
    }
  }, [onRevokeShare]);

  const handleCopyLink = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  }, []);

  const getShareUrl = (token: string) => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/shared/${token}`;
    }
    return `/shared/${token}`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: SharedAccess['status']) => {
    const styles = {
      active: 'bg-green-500/10 text-green-400 border-green-500/20',
      expired: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
      revoked: 'bg-red-500/10 text-red-400 border-red-500/20',
    };
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Modal */}
      <div 
        className="relative bg-neutral-900 border border-neutral-700/50 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
          <h2 id="share-modal-title" className="text-lg font-semibold text-neutral-100">
            Share {scope === 'task' ? 'Task' : 'Project'}
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 transition-colors p-1"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Preview Step */}
          {step === 'preview' && (
            <div className="space-y-6">
              <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-neutral-300 mb-3">What will be shared</h3>
                <p className="text-neutral-100 font-medium mb-2">{resourceName}</p>
                {preview && (
                  <div className="space-y-3 mt-3">
                    <div>
                      <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">Shared Fields</p>
                      <div className="flex flex-wrap gap-1.5">
                        {preview.sharedFields.map((field) => (
                          <span key={field} className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded border border-blue-500/20">
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                    {preview.sensitiveFields.length > 0 && (
                      <div>
                        <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">Not Shared (Sensitive)</p>
                        <div className="flex flex-wrap gap-1.5">
                          {preview.sensitiveFields.map((field) => (
                            <span key={field} className="px-2 py-0.5 bg-neutral-700/50 text-neutral-400 text-xs rounded border border-neutral-600/50">
                              {field}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 bg-neutral-800 text-neutral-300 rounded-lg font-medium hover:bg-neutral-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep('configure')}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500 transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Configure Step */}
          {step === 'configure' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Visibility</label>
                <div className="space-y-2">
                  {VISIBILITY_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        visibility === option.value
                          ? 'bg-blue-500/10 border-blue-500/50'
                          : 'bg-neutral-800/50 border-neutral-700/50 hover:border-neutral-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="visibility"
                        value={option.value}
                        checked={visibility === option.value}
                        onChange={() => setVisibility(option.value)}
                        className="mt-1"
                      />
                      <div>
                        <p className="text-sm font-medium text-neutral-200">{option.label}</p>
                        <p className="text-xs text-neutral-400">{option.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {visibility === 'password_protected' && (
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-2">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter a password for access"
                    className="w-full bg-neutral-800 border border-neutral-700/50 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                  />
                  <p className="text-xs text-neutral-500 mt-1">Share this password separately from the link</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Expiration</label>
                <select
                  value={expiresIn ?? ''}
                  onChange={(e) => setExpiresIn(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full bg-neutral-800 border border-neutral-700/50 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                >
                  {EXPIRATION_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value ?? ''}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('preview')}
                  className="flex-1 px-4 py-2.5 bg-neutral-800 text-neutral-300 rounded-lg font-medium hover:bg-neutral-700 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleCreateShare}
                  disabled={isCreating || (visibility === 'password_protected' && !password)}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? 'Creating...' : 'Create Share Link'}
                </button>
              </div>
            </div>
          )}

          {/* Success Step */}
          {step === 'success' && createdShare && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-green-400 text-sm font-medium">Share link created successfully</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Share Link</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={getShareUrl(createdShare.shareToken)}
                    readOnly
                    className="flex-1 bg-neutral-800 border border-neutral-700/50 rounded-lg px-4 py-2.5 text-sm font-mono"
                  />
                  <button
                    onClick={() => handleCopyLink(getShareUrl(createdShare.shareToken))}
                    className={`px-4 py-2.5 rounded-lg font-medium transition-colors ${
                      copied
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700/50'
                    }`}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {createdShare.visibility === 'password_protected' && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <p className="text-yellow-400 text-sm">
                    Remember to share the password separately with intended recipients.
                  </p>
                </div>
              )}

              <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-400">Visibility</span>
                  <span className="text-neutral-200 capitalize">{createdShare.visibility.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-400">Expires</span>
                  <span className="text-neutral-200">{formatDate(createdShare.expiresAt)}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('manage')}
                  className="flex-1 px-4 py-2.5 bg-neutral-800 text-neutral-300 rounded-lg font-medium hover:bg-neutral-700 transition-colors"
                >
                  Manage Shares
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Manage Step */}
          {step === 'manage' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-neutral-300">Active Shares</h3>
                <button
                  onClick={() => setStep('configure')}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + Create new
                </button>
              </div>

              {existingShares.length === 0 ? (
                <div className="text-center py-8 text-neutral-500">
                  <p>No active shares</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {existingShares.map((share) => (
                    <div
                      key={share.id}
                      className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getStatusBadge(share.status)}
                            <span className="text-xs text-neutral-500 capitalize">
                              {share.visibility.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-xs text-neutral-400 font-mono truncate">
                            {getShareUrl(share.shareToken)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleCopyLink(getShareUrl(share.shareToken))}
                          className="text-neutral-400 hover:text-neutral-200 transition-colors p-1"
                          title="Copy link"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-xs text-neutral-500">
                        <div className="flex gap-4">
                          <span>Created: {formatDate(share.createdAt)}</span>
                          {share.expiresAt && <span>Expires: {formatDate(share.expiresAt)}</span>}
                        </div>
                        {share.status === 'active' && (
                          <button
                            onClick={() => handleRevokeShare(share.id)}
                            disabled={isRevoking === share.id}
                            className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                          >
                            {isRevoking === share.id ? 'Revoking...' : 'Revoke'}
                          </button>
                        )}
                      </div>
                      {share.accessCount > 0 && (
                        <p className="text-xs text-neutral-500 mt-2">
                          Accessed {share.accessCount} time{share.accessCount !== 1 ? 's' : ''}
                          {share.lastAccessedAt && ` • Last: ${formatDate(share.lastAccessedAt)}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 bg-neutral-800 text-neutral-300 rounded-lg font-medium hover:bg-neutral-700 transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
