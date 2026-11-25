'use client';

import { useCallback, useState } from 'react';
import { useEncryptionKeyManager } from '@/src/hooks/useEncryptionKeyManager';
import type { EncryptionKey } from '@/src/lib/encryption/types';

function KeyStatusBadge({ status }: { status: EncryptionKey['status'] }) {
  const colours: Record<EncryptionKey['status'], string> = {
    active: 'text-emerald-300 border-emerald-700',
    rotated: 'text-yellow-300 border-yellow-700',
    revoked: 'text-rose-300 border-rose-700',
  };
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${colours[status]}`}>
      {status}
    </span>
  );
}

function KeyRow({
  keyMeta,
  isActive,
  onRevoke,
}: {
  keyMeta: EncryptionKey;
  isActive: boolean;
  onRevoke: (id: string) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-800/50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm text-neutral-100">
          {keyMeta.label ?? keyMeta.id.slice(0, 16) + '…'}
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {keyMeta.algorithm} · {keyMeta.purpose} · created {new Date(keyMeta.createdAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isActive && (
          <span className="rounded border border-blue-700 px-2 py-0.5 text-xs font-medium text-blue-300">
            active
          </span>
        )}
        <KeyStatusBadge status={keyMeta.status} />
        {keyMeta.status === 'active' && (
          <button
            type="button"
            onClick={() => onRevoke(keyMeta.id)}
            className="rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-400 hover:border-rose-500 hover:text-rose-300"
          >
            Revoke
          </button>
        )}
      </div>
    </li>
  );
}

export function EncryptionKeyManagerPanel() {
  const {
    status,
    isReady,
    activeKeyId,
    allActiveKeys,
    error,
    lastRotation,
    initialize,
    generateKey,
    rotateActiveKey,
    revokeKey,
    reset,
  } = useEncryptionKeyManager();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleInitialize = useCallback(async () => {
    if (!password.trim()) {
      setLocalError('Password is required to initialize encryption.');
      return;
    }
    setBusy(true);
    setLocalError(null);
    await initialize({ password });
    setBusy(false);
    setPassword('');
  }, [initialize, password]);

  const handleInitializeClick = useCallback(() => {
    if (!password.trim()) {
      setLocalError('Password is required to initialize encryption.');
      return;
    }
    void handleInitialize();
  }, [handleInitialize, password]);

  const handleGenerateKey = useCallback(async () => {
    setBusy(true);
    await generateKey('encrypt', 'AES-GCM', `key-${Date.now()}`);
    setBusy(false);
  }, [generateKey]);

  const handleRotate = useCallback(async () => {
    setBusy(true);
    await rotateActiveKey();
    setBusy(false);
  }, [rotateActiveKey]);

  const handleRevoke = useCallback((id: string) => {
    revokeKey(id);
  }, [revokeKey]);

  const handleReset = useCallback(() => {
    reset();
    setPassword('');
    setLocalError(null);
  }, [reset]);

  const displayError = localError ?? error;

  return (
    <section
      data-testid="encryption-key-manager-panel"
      className="rounded-xl border border-neutral-700 bg-neutral-900/60 p-5 space-y-5"
    >
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">Encryption Key Manager</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Manage client-side encryption keys. Keys never leave your device.
          </p>
        </div>
        <span
          data-testid="enc-status-badge"
          className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
            status === 'ready'
              ? 'bg-emerald-900/50 text-emerald-300'
              : status === 'error'
              ? 'bg-rose-900/50 text-rose-300'
              : status === 'rotating'
              ? 'bg-yellow-900/50 text-yellow-300'
              : 'bg-neutral-800 text-neutral-400'
          }`}
        >
          {status}
        </span>
      </header>

      {displayError && (
        <p role="alert" className="rounded-lg bg-rose-900/30 border border-rose-700 px-4 py-2 text-sm text-rose-300">
          {displayError}
        </p>
      )}

      {lastRotation && (
        <p className="rounded-lg bg-yellow-900/20 border border-yellow-700 px-4 py-2 text-xs text-yellow-300">
          Key rotated at {new Date(lastRotation.rotatedAt).toLocaleString()} —{' '}
          new key: {lastRotation.newKeyId.slice(0, 12)}…
        </p>
      )}

      {!isReady && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-300">
            Enter a master password to derive your encryption key and initialize the key manager.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              aria-label="Master password"
              placeholder="Master password…"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInitializeClick()}
              className="flex-1 rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleInitializeClick}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {busy ? 'Initializing…' : 'Initialize'}
            </button>
          </div>
        </div>
      )}

      {isReady && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !activeKeyId}
              onClick={handleRotate}
              className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-200 hover:border-yellow-500 disabled:opacity-40"
            >
              {busy && status === 'rotating' ? 'Rotating…' : 'Rotate Active Key'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleGenerateKey}
              className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-200 hover:border-blue-500 disabled:opacity-40"
            >
              Generate New Key
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-400 hover:border-rose-500 hover:text-rose-300"
            >
              Reset
            </button>
          </div>

          {allActiveKeys.length > 0 ? (
            <ul className="space-y-2">
              {allActiveKeys.map((k) => (
                <KeyRow
                  key={k.id}
                  keyMeta={k}
                  isActive={k.id === activeKeyId}
                  onRevoke={handleRevoke}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">No active keys.</p>
          )}
        </>
      )}
    </section>
  );
}
