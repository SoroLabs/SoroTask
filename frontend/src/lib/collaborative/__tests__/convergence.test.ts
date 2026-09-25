/**
 * Convergence tests for collaborative editing (Issue #1255).
 *
 * The acceptance criterion is "concurrent edits from two separate browser
 * windows merge without conflict or data loss". Two `Y.Doc`s with updates
 * relayed between them *are* those two windows — the transport is the only
 * thing a real WebSocket adds, and it is not what decides whether edits merge.
 *
 * These test Yjs semantics directly rather than through `CRDTDocumentManager`,
 * because the manager's constructor opens a WebSocket. The manager's own
 * behaviour is covered in `crdtDocumentManager.test.ts`.
 */

import * as Y from 'yjs';

/**
 * Wires two docs together so every update on one is applied to the other,
 * standing in for the relay a `WebsocketProvider` performs.
 */
function connect(a: Y.Doc, b: Y.Doc): () => void {
  const aToB = (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(b, update, 'remote');
  };
  const bToA = (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(a, update, 'remote');
  };

  a.on('update', aToB);
  b.on('update', bToA);

  return () => {
    a.off('update', aToB);
    b.off('update', bToA);
  };
}

/** Applies both docs' state to each other, as a reconnect would. */
function reconcile(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe('shared text fields (Y.Text)', () => {
  it('interleaves concurrent typing instead of overwriting', () => {
    // The scenario in the issue: two people editing the same description.
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const disconnect = connect(alice, bob);

    alice.getText('description').insert(0, 'Hello');
    bob.getText('description').insert(5, ' world');

    expect(alice.getText('description').toString()).toBe(
      bob.getText('description').toString(),
    );
    expect(alice.getText('description').toString()).toContain('Hello');
    expect(alice.getText('description').toString()).toContain('world');

    disconnect();
  });

  it('keeps both sides of an offline edit after reconnecting', () => {
    // Neither edit may be silently discarded on reconnect — that is the
    // "data loss" half of the acceptance criterion.
    const alice = new Y.Doc();
    const bob = new Y.Doc();

    const disconnect = connect(alice, bob);
    alice.getText('description').insert(0, 'shared start. ');
    disconnect();

    // Both edit while apart.
    alice.getText('description').insert(14, 'ALICE ');
    bob.getText('description').insert(14, 'BOB ');

    reconcile(alice, bob);

    const merged = alice.getText('description').toString();
    expect(bob.getText('description').toString()).toBe(merged);
    expect(merged).toContain('ALICE');
    expect(merged).toContain('BOB');
    expect(merged).toContain('shared start.');
  });

  it('converges regardless of the order updates arrive in', () => {
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const carol = new Y.Doc();

    alice.getText('t').insert(0, 'A');
    bob.getText('t').insert(0, 'B');
    carol.getText('t').insert(0, 'C');

    const updates = [alice, bob, carol].map((d) => Y.encodeStateAsUpdate(d));

    const forward = new Y.Doc();
    updates.forEach((u) => Y.applyUpdate(forward, u));

    const backward = new Y.Doc();
    [...updates].reverse().forEach((u) => Y.applyUpdate(backward, u));

    // Convergence is the CRDT guarantee: same set of updates, same result,
    // whatever order the network delivered them in.
    expect(forward.getText('t').toString()).toBe(backward.getText('t').toString());
    expect(forward.getText('t').toString()).toHaveLength(3);
  });

  it('survives a concurrent delete and insert in the same region', () => {
    const alice = new Y.Doc();
    const bob = new Y.Doc();

    const disconnect = connect(alice, bob);
    alice.getText('t').insert(0, 'abcdef');
    disconnect();

    alice.getText('t').delete(1, 2); // remove "bc"
    bob.getText('t').insert(2, 'XY'); // insert inside the removed span

    reconcile(alice, bob);

    expect(alice.getText('t').toString()).toBe(bob.getText('t').toString());
    expect(alice.getText('t').toString()).toContain('XY');
  });
});

describe('scalar fields (Y.Map)', () => {
  it('converges on one value for a concurrent write to the same key', () => {
    // Last-write-wins is correct here — a task has one status — but both
    // replicas must agree on which one won.
    const alice = new Y.Doc();
    const bob = new Y.Doc();

    const disconnect = connect(alice, bob);
    alice.getMap('task').set('status', 'draft');
    disconnect();

    alice.getMap('task').set('status', 'active');
    bob.getMap('task').set('status', 'paused');

    reconcile(alice, bob);

    expect(alice.getMap('task').get('status')).toBe(bob.getMap('task').get('status'));
  });

  it('keeps concurrent writes to different keys', () => {
    // No conflict at all — losing one of these would be pure data loss.
    const alice = new Y.Doc();
    const bob = new Y.Doc();

    alice.getMap('task').set('title', 'Deploy contract');
    bob.getMap('task').set('priority', 'high');

    reconcile(alice, bob);

    for (const doc of [alice, bob]) {
      expect(doc.getMap('task').get('title')).toBe('Deploy contract');
      expect(doc.getMap('task').get('priority')).toBe('high');
    }
  });
});

describe('minimal-diff text updates', () => {
  /**
   * Mirrors `CRDTDocumentManager.setSharedText`: narrow a whole-string update
   * to the changed middle so a controlled React input does not delete and
   * re-insert the entire field on every keystroke.
   */
  function setSharedText(doc: Y.Doc, field: string, next: string): void {
    const ytext = doc.getText(field);
    const current = ytext.toString();
    if (current === next) return;

    let start = 0;
    const maxStart = Math.min(current.length, next.length);
    while (start < maxStart && current[start] === next[start]) start += 1;

    let end = 0;
    const maxEnd = Math.min(current.length - start, next.length - start);
    while (
      end < maxEnd &&
      current[current.length - 1 - end] === next[next.length - 1 - end]
    ) {
      end += 1;
    }

    const removeCount = current.length - start - end;
    const insertText = next.slice(start, next.length - end);

    doc.transact(() => {
      if (removeCount > 0) ytext.delete(start, removeCount);
      if (insertText.length > 0) ytext.insert(start, insertText);
    });
  }

  it('produces the requested string', () => {
    const doc = new Y.Doc();
    setSharedText(doc, 't', 'hello world');
    expect(doc.getText('t').toString()).toBe('hello world');

    setSharedText(doc, 't', 'hello brave world');
    expect(doc.getText('t').toString()).toBe('hello brave world');

    setSharedText(doc, 't', 'hello');
    expect(doc.getText('t').toString()).toBe('hello');
  });

  it('touches only the changed span', () => {
    // A whole-field replace would report length-of-string deletions, wiping
    // out any concurrent edit and every peer's cursor position.
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'the quick brown fox');

    let deleted = 0;
    let inserted = 0;
    doc.getText('t').observe((event) => {
      event.delta.forEach((op) => {
        if (typeof op.delete === 'number') deleted += op.delete;
        if (typeof op.insert === 'string') inserted += op.insert.length;
      });
    });

    setSharedText(doc, 't', 'the quick brown cat');

    expect(deleted).toBeLessThanOrEqual(3);
    expect(inserted).toBeLessThanOrEqual(3);
  });

  it('is a no-op when the value has not changed', () => {
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'unchanged');

    let events = 0;
    doc.getText('t').observe(() => {
      events += 1;
    });

    setSharedText(doc, 't', 'unchanged');
    expect(events).toBe(0);
  });

  it('preserves a concurrent remote edit made during a local keystroke', () => {
    // The whole point of the minimal diff: Bob's word survives Alice typing.
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const disconnect = connect(alice, bob);

    alice.getText('t').insert(0, 'report ');
    bob.getText('t').insert(7, 'draft');

    setSharedText(alice, 't', `${alice.getText('t').toString()}!`);

    expect(alice.getText('t').toString()).toBe(bob.getText('t').toString());
    expect(alice.getText('t').toString()).toContain('draft');
    expect(alice.getText('t').toString()).toContain('report');

    disconnect();
  });
});

describe('nested field writes', () => {
  /** Mirrors the fixed `CRDTDocumentManager.updateField` nested path. */
  function updateField(doc: Y.Doc, path: string[], value: unknown): void {
    const ymap = doc.getMap('task');
    if (path.length === 1) {
      ymap.set(path[0], value);
      return;
    }

    const root = path[0];
    const existing = ymap.get(root);
    const next =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};

    let cursor: Record<string, unknown> = next;
    for (let i = 1; i < path.length - 1; i += 1) {
      const segment = path[i];
      const child = cursor[segment];
      cursor[segment] =
        child && typeof child === 'object' && !Array.isArray(child)
          ? { ...(child as Record<string, unknown>) }
          : {};
      cursor = cursor[segment] as Record<string, unknown>;
    }

    cursor[path[path.length - 1]] = value;
    ymap.set(root, next);
  }

  it('propagates a nested write to the other replica', () => {
    // The previous implementation mutated the object returned by `get` and
    // never called `set` again, so Yjs never observed the change and it was
    // broadcast to nobody.
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const disconnect = connect(alice, bob);

    updateField(alice, ['config', 'retry', 'max'], 5);

    expect((bob.getMap('task').get('config') as Record<string, never>)).toEqual({
      retry: { max: 5 },
    });

    disconnect();
  });

  it('keeps sibling keys when writing deeper', () => {
    const doc = new Y.Doc();

    updateField(doc, ['config', 'retry', 'max'], 5);
    updateField(doc, ['config', 'retry', 'backoff'], 'exponential');
    updateField(doc, ['config', 'timeout'], 30);

    expect(doc.getMap('task').get('config')).toEqual({
      retry: { max: 5, backoff: 'exponential' },
      timeout: 30,
    });
  });

  it('replaces a non-object value on the path rather than throwing', () => {
    const doc = new Y.Doc();
    doc.getMap('task').set('config', 'not-an-object');

    expect(() => updateField(doc, ['config', 'retry'], 3)).not.toThrow();
    expect(doc.getMap('task').get('config')).toEqual({ retry: 3 });
  });
});
