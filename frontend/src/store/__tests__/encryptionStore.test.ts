import { useEncryptionStore, selectActiveKey, selectActiveKeys, selectIsReady } from '../encryptionStore';

// Reset the store between tests
beforeEach(() => {
  useEncryptionStore.getState().reset();
});

const mockKey = (overrides = {}) => ({
  id: 'key-1',
  algorithm: 'AES-GCM' as const,
  purpose: 'encrypt' as const,
  status: 'active' as const,
  createdAt: 1000,
  ...overrides,
});

describe('encryptionStore', () => {
  // ── initial state ──────────────────────────────────────────────────────

  it('starts with idle status and null active key', () => {
    const state = useEncryptionStore.getState();
    expect(state.status).toBe('idle');
    expect(state.activeKeyId).toBeNull();
    expect(state.keys).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.lastRotation).toBeNull();
    expect(state.lastEncrypted).toBeNull();
  });

  // ── setStatus ──────────────────────────────────────────────────────────

  it('setStatus updates status and clears error for non-error statuses', () => {
    useEncryptionStore.getState().setError('some error');
    useEncryptionStore.getState().setStatus('ready');
    const state = useEncryptionStore.getState();
    expect(state.status).toBe('ready');
    expect(state.error).toBeNull();
  });

  it('setStatus to error preserves existing error', () => {
    useEncryptionStore.getState().setError('existing');
    useEncryptionStore.getState().setStatus('error');
    expect(useEncryptionStore.getState().status).toBe('error');
  });

  // ── setActiveKeyId ────────────────────────────────────────────────────

  it('setActiveKeyId updates activeKeyId', () => {
    useEncryptionStore.getState().setActiveKeyId('abc-123');
    expect(useEncryptionStore.getState().activeKeyId).toBe('abc-123');
  });

  it('setActiveKeyId accepts null', () => {
    useEncryptionStore.getState().setActiveKeyId('some-key');
    useEncryptionStore.getState().setActiveKeyId(null);
    expect(useEncryptionStore.getState().activeKeyId).toBeNull();
  });

  // ── setKeys ──────────────────────────────────────────────────────────

  it('setKeys replaces the keys array', () => {
    useEncryptionStore.getState().setKeys([mockKey(), mockKey({ id: 'key-2' })]);
    expect(useEncryptionStore.getState().keys).toHaveLength(2);
  });

  // ── addKey ────────────────────────────────────────────────────────────

  it('addKey appends a new key', () => {
    useEncryptionStore.getState().addKey(mockKey());
    expect(useEncryptionStore.getState().keys).toHaveLength(1);
  });

  it('addKey replaces a key with the same id (upsert)', () => {
    useEncryptionStore.getState().addKey(mockKey());
    useEncryptionStore.getState().addKey(mockKey({ label: 'updated' }));
    const keys = useEncryptionStore.getState().keys;
    expect(keys).toHaveLength(1);
    expect(keys[0].label).toBe('updated');
  });

  // ── updateKey ────────────────────────────────────────────────────────

  it('updateKey patches an existing key', () => {
    useEncryptionStore.getState().addKey(mockKey());
    useEncryptionStore.getState().updateKey('key-1', { status: 'rotated' });
    expect(useEncryptionStore.getState().keys[0].status).toBe('rotated');
  });

  it('updateKey is a no-op for unknown ids', () => {
    useEncryptionStore.getState().addKey(mockKey());
    useEncryptionStore.getState().updateKey('nonexistent', { status: 'revoked' });
    expect(useEncryptionStore.getState().keys[0].status).toBe('active');
  });

  // ── setLastRotation ──────────────────────────────────────────────────

  it('setLastRotation stores rotation result', () => {
    const rotation = { oldKeyId: 'old', newKeyId: 'new', rotatedAt: 9999 };
    useEncryptionStore.getState().setLastRotation(rotation);
    expect(useEncryptionStore.getState().lastRotation).toEqual(rotation);
  });

  // ── setError ────────────────────────────────────────────────────────

  it('setError stores error and sets status to error', () => {
    useEncryptionStore.getState().setError('something broke');
    const state = useEncryptionStore.getState();
    expect(state.error).toBe('something broke');
    expect(state.status).toBe('error');
  });

  it('setError(null) clears error and sets status to idle', () => {
    useEncryptionStore.getState().setError('err');
    useEncryptionStore.getState().setError(null);
    const state = useEncryptionStore.getState();
    expect(state.error).toBeNull();
    expect(state.status).toBe('idle');
  });

  // ── setLastEncrypted ─────────────────────────────────────────────────

  it('setLastEncrypted stores the last payload', () => {
    const payload = { ciphertext: 'abc', iv: 'xyz', keyId: 'k1', algorithm: 'AES-GCM' as const };
    useEncryptionStore.getState().setLastEncrypted(payload);
    expect(useEncryptionStore.getState().lastEncrypted).toEqual(payload);
  });

  // ── reset ─────────────────────────────────────────────────────────────

  it('reset restores initial state', () => {
    useEncryptionStore.getState().setStatus('ready');
    useEncryptionStore.getState().addKey(mockKey());
    useEncryptionStore.getState().setError('oops');
    useEncryptionStore.getState().reset();

    const state = useEncryptionStore.getState();
    expect(state.status).toBe('idle');
    expect(state.keys).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.activeKeyId).toBeNull();
  });

  // ── selectors ─────────────────────────────────────────────────────────

  describe('selectActiveKey', () => {
    it('returns the active key when it exists', () => {
      const state = useEncryptionStore.getState();
      state.addKey(mockKey());
      state.setActiveKeyId('key-1');
      const active = selectActiveKey(useEncryptionStore.getState());
      expect(active?.id).toBe('key-1');
    });

    it('returns null when activeKeyId is null', () => {
      expect(selectActiveKey(useEncryptionStore.getState())).toBeNull();
    });

    it('returns null when activeKeyId does not match any key', () => {
      useEncryptionStore.getState().setActiveKeyId('ghost');
      expect(selectActiveKey(useEncryptionStore.getState())).toBeNull();
    });
  });

  describe('selectActiveKeys', () => {
    it('returns only keys with status=active', () => {
      const state = useEncryptionStore.getState();
      state.addKey(mockKey({ id: 'k1', status: 'active' }));
      state.addKey(mockKey({ id: 'k2', status: 'rotated' }));
      state.addKey(mockKey({ id: 'k3', status: 'revoked' }));
      const active = selectActiveKeys(useEncryptionStore.getState());
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('k1');
    });
  });

  describe('selectIsReady', () => {
    it('returns true when status=ready and activeKeyId is set', () => {
      const state = useEncryptionStore.getState();
      state.setStatus('ready');
      state.setActiveKeyId('k1');
      expect(selectIsReady(useEncryptionStore.getState())).toBe(true);
    });

    it('returns false when status is not ready', () => {
      const state = useEncryptionStore.getState();
      state.setActiveKeyId('k1');
      expect(selectIsReady(useEncryptionStore.getState())).toBe(false);
    });

    it('returns false when activeKeyId is null', () => {
      useEncryptionStore.getState().setStatus('ready');
      expect(selectIsReady(useEncryptionStore.getState())).toBe(false);
    });
  });
});
