'use client';

import { useState, useRef, useEffect } from 'react';
import type { SavedView } from '@/types/search';

interface SavedViewsPanelProps {
  savedViews: SavedView[];
  activeViewId: string | null;
  hasActiveFilters: boolean;
  onSaveView: (name: string) => void;
  onLoadView: (viewId: string) => void;
  onDeleteView: (viewId: string) => void;
  onUpdateView: (viewId: string, name: string) => void;
  onCopyShareableUrl: () => void;
}

export function SavedViewsPanel({
  savedViews,
  activeViewId,
  hasActiveFilters,
  onSaveView,
  onLoadView,
  onDeleteView,
  onUpdateView,
  onCopyShareableUrl,
}: SavedViewsPanelProps) {
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showSaveForm) {
      saveInputRef.current?.focus();
    }
  }, [showSaveForm]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSave = () => {
    const name = newViewName.trim();
    if (!name) return;
    onSaveView(name);
    setNewViewName('');
    setShowSaveForm(false);
  };

  const handleEditSave = (viewId: string) => {
    const name = editingName.trim();
    if (!name) return;
    onUpdateView(viewId, name);
    setEditingViewId(null);
    setEditingName('');
  };

  const handleCopyUrl = () => {
    onCopyShareableUrl();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Saved Views</h3>
        <div className="flex items-center gap-2">
          {/* Share URL button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleCopyUrl}
              className={`text-xs flex items-center gap-1 transition-colors ${
                copied ? 'text-green-400' : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="Copy shareable URL"
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </>
              )}
            </button>
          )}
          {/* Save current view */}
          {hasActiveFilters && !showSaveForm && (
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Save view
            </button>
          )}
        </div>
      </div>

      {/* Save form */}
      {showSaveForm && (
        <div className="flex items-center gap-2">
          <input
            ref={saveInputRef}
            type="text"
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') { setShowSaveForm(false); setNewViewName(''); }
            }}
            placeholder="View name..."
            className="flex-1 bg-neutral-800 border border-neutral-700/50 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            aria-label="New view name"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!newViewName.trim()}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setShowSaveForm(false); setNewViewName(''); }}
            className="px-3 py-1.5 bg-neutral-700 text-neutral-300 text-sm rounded-lg hover:bg-neutral-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Views list */}
      {savedViews.length === 0 ? (
        <p className="text-xs text-neutral-600 italic">
          {hasActiveFilters ? 'Save your current filters as a view.' : 'No saved views yet.'}
        </p>
      ) : (
        <div className="space-y-1" role="list" aria-label="Saved views">
          {savedViews.map((view) => (
            <div
              key={view.id}
              role="listitem"
              className={`flex items-center gap-2 px-3 py-2 rounded-lg group transition-colors ${
                activeViewId === view.id
                  ? 'bg-blue-500/10 border border-blue-500/20'
                  : 'hover:bg-neutral-800/50 border border-transparent'
              }`}
            >
              {editingViewId === view.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditSave(view.id);
                    if (e.key === 'Escape') { setEditingViewId(null); setEditingName(''); }
                  }}
                  onBlur={() => handleEditSave(view.id)}
                  className="flex-1 bg-neutral-700 border border-neutral-600 rounded px-2 py-0.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                  aria-label="Edit view name"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onLoadView(view.id)}
                  className="flex-1 text-left text-sm truncate"
                >
                  <span className={activeViewId === view.id ? 'text-blue-300 font-medium' : 'text-neutral-300'}>
                    {view.name}
                  </span>
                </button>
              )}

              {/* View menu */}
              <div className="relative flex-shrink-0" ref={menuOpenId === view.id ? menuRef : null}>
                <button
                  type="button"
                  onClick={() => setMenuOpenId(menuOpenId === view.id ? null : view.id)}
                  className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-neutral-300 transition-all p-0.5 rounded"
                  aria-label={`Options for ${view.name}`}
                  aria-haspopup="true"
                  aria-expanded={menuOpenId === view.id}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>

                {menuOpenId === view.id && (
                  <div className="absolute right-0 top-full mt-1 z-20 bg-neutral-800 border border-neutral-700/50 rounded-lg shadow-xl py-1 min-w-[120px]">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingViewId(view.id);
                        setEditingName(view.name);
                        setMenuOpenId(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700/50 transition-colors"
                    >
                      Rename
                    </button>
                    {activeViewId === view.id && hasActiveFilters && (
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateView(view.id, view.name);
                          setMenuOpenId(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700/50 transition-colors"
                      >
                        Update filters
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteView(view.id);
                        setMenuOpenId(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-neutral-700/50 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
