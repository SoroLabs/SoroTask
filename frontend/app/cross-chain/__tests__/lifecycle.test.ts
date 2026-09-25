import {
  buildExplorerLink,
  deriveLifecycle,
  isStageStalled,
  lifecycleProgress,
  STAGE_ORDER,
  STAGE_STALL_THRESHOLD_MS,
  summariseLifecycle,
} from '../lifecycle';
import type { BridgeEvent } from '../types';

/**
 * Cross-chain lifecycle model (Issue #1252).
 *
 * The distinction these pin is the one the feature exists for: a message that
 * has confirmed on the source and not yet appeared on the destination is
 * either healthily in flight or stuck, and the UI has to be able to tell them
 * apart.
 */

const NOW = new Date('2026-09-25T12:00:00.000Z').getTime();

function event(
  eventType: BridgeEvent['eventType'],
  minutesAgo: number,
  overrides: Partial<BridgeEvent> = {},
): BridgeEvent {
  return {
    id: `ev-${eventType}-${minutesAgo}`,
    taskId: 'cct-1',
    fromNetwork: 'ethereum',
    toNetwork: 'soroban',
    eventType,
    timestamp: new Date(NOW - minutesAgo * 60_000).toISOString(),
    ...overrides,
  };
}

describe('deriveLifecycle', () => {
  it('reports every stage as pending when nothing has happened', () => {
    const stages = deriveLifecycle([], NOW);
    expect(stages).toHaveLength(STAGE_ORDER.length);
    expect(stages.every((s) => s.status === 'pending')).toBe(true);
  });

  it('marks the source commit active once the message is initiated', () => {
    const stages = deriveLifecycle([event('initiated', 1)], NOW);
    expect(stages[0].status).toBe('active');
    expect(stages[1].status).toBe('pending');
  });

  it('advances to the relay stage once the message is in flight', () => {
    const stages = deriveLifecycle([event('initiated', 10), event('in_flight', 5)], NOW);
    const relay = stages.find((s) => s.id === 'relay_transport');

    expect(relay?.status).toBe('active');
    // Everything before the active stage is complete, which is what makes the
    // pipeline readable as a sequence rather than a set of independent flags.
    expect(stages[0].status).toBe('complete');
    expect(stages[1].status).toBe('complete');
  });

  it('completes every stage once the message settles', () => {
    const stages = deriveLifecycle(
      [event('initiated', 20), event('in_flight', 15), event('settled', 2)],
      NOW,
    );
    expect(stages.every((s) => s.status === 'complete')).toBe(true);
  });

  it('marks the stage that failed and leaves later stages pending', () => {
    const stages = deriveLifecycle(
      [event('initiated', 10), event('failed', 5, { detail: 'relay rejected message' })],
      NOW,
    );

    const failed = stages.find((s) => s.status === 'failed');
    expect(failed).toBeDefined();
    expect(failed?.error).toBe('relay rejected message');

    // Nothing after a failure ever ran; showing it as anything but pending
    // would imply it still might.
    const failedIndex = stages.indexOf(failed!);
    expect(stages.slice(failedIndex + 1).every((s) => s.status === 'pending')).toBe(true);
  });

  it('marks a long-running active stage as stalled rather than failed', () => {
    const minutes = STAGE_STALL_THRESHOLD_MS.relay_transport / 60_000 + 5;
    const stages = deriveLifecycle(
      [event('initiated', minutes + 10), event('in_flight', minutes)],
      NOW,
    );

    const relay = stages.find((s) => s.id === 'relay_transport');
    // Stalled, not failed: it may still resolve, and calling it a failure
    // sends the user to support for something that would have cleared.
    expect(relay?.status).toBe('stalled');
  });

  it('does not stall a stage that is merely slow', () => {
    const minutes = STAGE_STALL_THRESHOLD_MS.relay_transport / 60_000 - 5;
    const stages = deriveLifecycle(
      [event('initiated', minutes + 10), event('in_flight', minutes)],
      NOW,
    );
    expect(stages.find((s) => s.id === 'relay_transport')?.status).toBe('active');
  });

  it('is insensitive to the order events are supplied in', () => {
    const forwards = deriveLifecycle([event('initiated', 10), event('in_flight', 5)], NOW);
    const backwards = deriveLifecycle([event('in_flight', 5), event('initiated', 10)], NOW);
    expect(backwards.map((s) => s.status)).toEqual(forwards.map((s) => s.status));
  });
});

describe('isStageStalled', () => {
  it('is false without an entry time', () => {
    expect(isStageStalled('relay_transport', undefined, NOW)).toBe(false);
  });

  it('is false for an unparseable entry time', () => {
    expect(isStageStalled('relay_transport', 'not-a-date', NOW)).toBe(false);
  });

  it('gives relay transport the longest window', () => {
    // It has the least visibility and the most variance, so it earns the most
    // patience before being called stuck.
    expect(STAGE_STALL_THRESHOLD_MS.relay_transport).toBeGreaterThan(
      STAGE_STALL_THRESHOLD_MS.source_commit,
    );
    expect(STAGE_STALL_THRESHOLD_MS.relay_transport).toBeGreaterThan(
      STAGE_STALL_THRESHOLD_MS.destination_execution,
    );
  });
});

describe('buildExplorerLink', () => {
  it('builds a link for each supported network', () => {
    expect(buildExplorerLink('ethereum', '0xabc')?.url).toContain('etherscan.io/tx/0xabc');
    expect(buildExplorerLink('polygon', '0xabc')?.label).toBe('PolygonScan');
    expect(buildExplorerLink('soroban', 'abc123')?.label).toBe('Stellar Expert');
  });

  it('returns null without a hash', () => {
    // A link that 404s is worse than no link: the user concludes the
    // transaction is missing rather than the link being wrong.
    expect(buildExplorerLink('ethereum', undefined)).toBeNull();
    expect(buildExplorerLink('ethereum', '   ')).toBeNull();
  });

  it('encodes the hash', () => {
    expect(buildExplorerLink('ethereum', 'a b')?.url).toContain('a%20b');
  });
});

describe('lifecycleProgress', () => {
  it('is zero before anything completes and one when settled', () => {
    expect(lifecycleProgress(deriveLifecycle([], NOW))).toBe(0);
    const settled = deriveLifecycle(
      [event('initiated', 20), event('in_flight', 15), event('settled', 2)],
      NOW,
    );
    expect(lifecycleProgress(settled)).toBe(1);
  });
});

describe('summariseLifecycle', () => {
  it('names the current stage while in progress', () => {
    const stages = deriveLifecycle([event('initiated', 10), event('in_flight', 5)], NOW);
    expect(summariseLifecycle(stages)).toBe('In progress: ccip relay');
  });

  it('reports settled and not-started distinctly', () => {
    expect(summariseLifecycle(deriveLifecycle([], NOW))).toBe('Not started');
    const settled = deriveLifecycle(
      [event('initiated', 20), event('in_flight', 15), event('settled', 2)],
      NOW,
    );
    expect(summariseLifecycle(settled)).toBe('Settled on destination');
  });

  it('prefers a failure over a stall in the summary', () => {
    const stages = deriveLifecycle(
      [event('initiated', 10), event('failed', 5, { detail: 'reverted' })],
      NOW,
    );
    expect(summariseLifecycle(stages)).toMatch(/^Failed at/);
  });
});
