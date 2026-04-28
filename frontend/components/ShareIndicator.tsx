'use client';

import { useState } from 'react';
import type { SharedAccess } from '@/types/sharing';

interface ShareIndicatorProps {
  shares: SharedAccess[];
  onOpenShareModal: () => void;
  compact?: boolean;
}

export function ShareIndicator({ shares, onOpenShareModal, compact = false }: ShareIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const activeShares = shares.filter((s) => s.status === 'active');
  const expiredShares = shares.filter((s) => s.status === 'expired');
  const revokedShares = shares.filter((s) => s.status === 'revoked');

  const hasActiveShares = activeShares.length > 0;
  const hasIssues = expiredShares.length > 0 || revokedShares.length > 0;

  if (shares.length === 0) {
    return (
      <button
        onClick={onOpenShareModal}
        className={`inline-flex items-center gap-1.5 text-neutral-400 hover:text-neutral-200 transition-colors ${
          compact ? 'text-xs' : 'text-sm'
        }`}
        aria-label="Create share link"
      >
        <svg className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        {!compact && <span>Share</span>}
      </button>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={onOpenShareModal}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`inline-flex items-center gap-1.5 transition-colors ${
          hasActiveShares
            ? 'text-blue-400 hover:text-blue-300'
            : hasIssues
            ? 'text-yellow-400 hover:text-yellow-300'
            : 'text-neutral-400 hover:text-neutral-200'
        } ${compact ? 'text-xs' : 'text-sm'}`}
        aria-label={`${activeShares.length} active share${activeShares.length !== 1 ? 's' : ''}`}
      >
        <svg className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        {!compact && (
          <span>
            {hasActiveShares ? (
              <>
                {activeShares.length} shared
                {expiredShares.length > 0 && (
                  <span className="text-yellow-400 ml-1">({expiredShares.length} expired)</span>
                )}
              </>
            ) : hasIssues ? (
              <span className="text-yellow-400">Share issues</span>
            ) : (
              'Share'
            )}
          </span>
        )}
        {hasActiveShares && (
          <span className="flex items-center justify-center w-4 h-4 text-[10px] font-medium bg-blue-500/20 text-blue-400 rounded-full">
            {activeShares.length}
          </span>
        )}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute z-10 bottom-full left-0 mb-2 w-48 p-2 bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg">
          <div className="text-xs space-y-1">
            {hasActiveShares && (
              <p className="text-blue-400">
                {activeShares.length} active share{activeShares.length !== 1 ? 's' : ''}
              </p>
            )}
            {expiredShares.length > 0 && (
              <p className="text-yellow-400">
                {expiredShares.length} expired share{expiredShares.length !== 1 ? 's' : ''}
              </p>
            )}
            {revokedShares.length > 0 && (
              <p className="text-red-400">
                {revokedShares.length} revoked share{revokedShares.length !== 1 ? 's' : ''}
              </p>
            )}
            <p className="text-neutral-400 pt-1 border-t border-neutral-700 mt-1">Click to manage</p>
          </div>
        </div>
      )}
    </div>
  );
}
