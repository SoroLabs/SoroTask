const { Keypair } = require('@stellar/stellar-sdk');
const {
  RELAY_ERROR,
  SponsorLedger,
  NonceStore,
  metaTxDigest,
  relayMetaTransaction,
} = require('../src/gasStationRelayer');

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

function signedPacket(keypair, overrides = {}, clock) {
  const base = {
    user: keypair.publicKey(),
    sponsorId: 'sponsor-a',
    innerXdr: 'AAAA-inner',
    nonce: 'n-1',
    expiresAt: clock.now() + 60_000,
    maxFeeStroops: 1_000,
    ...overrides,
  };
  const signature = Buffer.from(keypair.sign(metaTxDigest(base))).toString('base64');
  return { ...base, signature };
}

function setup() {
  const clock = makeClock();
  const ledger = new SponsorLedger({ windowMs: 60_000, now: clock.now });
  ledger.register('sponsor-a', {
    depositStroops: 10_000,
    maxTxPerWindow: 2,
    maxFeeStroopsPerTx: 5_000,
  });
  const nonces = new NonceStore({ now: clock.now });
  const submit = jest.fn(async () => ({ hash: 'tx-hash', feeCharged: 300 }));
  return { clock, ledger, nonces, submit, user: Keypair.random() };
}

async function expectRelayError(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('gas station relayer (#1466)', () => {
  it('submits a valid packet and charges only the actual fee to the sponsor', async () => {
    const { clock, ledger, nonces, submit, user } = setup();
    const packet = signedPacket(user, {}, clock);

    const result = await relayMetaTransaction({ packet, ledger, nonces, submit, now: clock.now });

    expect(result).toMatchObject({ status: 'submitted', hash: 'tx-hash', feeCharged: 300 });
    expect(submit).toHaveBeenCalledWith({ innerXdr: 'AAAA-inner', maxFeeStroops: 1_000 });
    expect(ledger.balance('sponsor-a')).toEqual({ depositStroops: 9_700, reservedStroops: 0 });
  });

  it('rejects an invalid user signature before reserving or submitting', async () => {
    const { clock, ledger, nonces, submit, user } = setup();
    const packet = signedPacket(user, {}, clock);
    const tampered = { ...packet, innerXdr: 'AAAA-other' };

    await expectRelayError(
      relayMetaTransaction({ packet: tampered, ledger, nonces, submit, now: clock.now }),
      RELAY_ERROR.INVALID_SIGNATURE
    );
    expect(submit).not.toHaveBeenCalled();
    expect(ledger.balance('sponsor-a')).toEqual({ depositStroops: 10_000, reservedStroops: 0 });
  });

  it('rejects an expired packet', async () => {
    const { clock, ledger, nonces, submit, user } = setup();
    const packet = signedPacket(user, { expiresAt: clock.now() - 1 }, clock);

    await expectRelayError(
      relayMetaTransaction({ packet, ledger, nonces, submit, now: clock.now }),
      RELAY_ERROR.EXPIRED
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects a replayed nonce and does not submit twice', async () => {
    const { clock, ledger, nonces, submit, user } = setup();
    const packet = signedPacket(user, {}, clock);

    await relayMetaTransaction({ packet, ledger, nonces, submit, now: clock.now });
    await expectRelayError(
      relayMetaTransaction({ packet, ledger, nonces, submit, now: clock.now }),
      RELAY_ERROR.REPLAY
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('enforces the per-window quota and resets it after the window', async () => {
    const { clock, ledger, nonces, submit, user } = setup();
    for (const nonce of ['q1', 'q2']) {
      await relayMetaTransaction({
        packet: signedPacket(user, { nonce }, clock),
        ledger,
        nonces,
        submit,
        now: clock.now,
      });
    }

    await expectRelayError(
      relayMetaTransaction({
        packet: signedPacket(user, { nonce: 'q3' }, clock),
        ledger,
        nonces,
        submit,
        now: clock.now,
      }),
      RELAY_ERROR.QUOTA_EXCEEDED
    );
    expect(submit).toHaveBeenCalledTimes(2);

    clock.advance(60_000);
    const after = await relayMetaTransaction({
      packet: signedPacket(user, { nonce: 'q4' }, clock),
      ledger,
      nonces,
      submit,
      now: clock.now,
    });
    expect(after.status).toBe('submitted');
  });

  it('rejects a fee above the per-transaction cap', async () => {
    const { clock, ledger, nonces, submit, user } = setup();
    await expectRelayError(
      relayMetaTransaction({
        packet: signedPacket(user, { maxFeeStroops: 6_000 }, clock),
        ledger,
        nonces,
        submit,
        now: clock.now,
      }),
      RELAY_ERROR.FEE_CAP_EXCEEDED
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects when the sponsor deposit cannot cover the reserved fee', async () => {
    const clock = makeClock();
    const ledger = new SponsorLedger({ windowMs: 60_000, now: clock.now });
    ledger.register('sponsor-a', { depositStroops: 500, maxTxPerWindow: 5, maxFeeStroopsPerTx: 5_000 });
    const nonces = new NonceStore({ now: clock.now });
    const submit = jest.fn(async () => ({ hash: 'h', feeCharged: 100 }));
    const user = Keypair.random();

    await expectRelayError(
      relayMetaTransaction({
        packet: signedPacket(user, { maxFeeStroops: 1_000 }, clock),
        ledger,
        nonces,
        submit,
        now: clock.now,
      }),
      RELAY_ERROR.INSUFFICIENT_DEPOSIT
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects an unknown sponsor', async () => {
    const { clock, ledger, nonces, submit, user } = setup();
    await expectRelayError(
      relayMetaTransaction({
        packet: signedPacket(user, { sponsorId: 'nobody' }, clock),
        ledger,
        nonces,
        submit,
        now: clock.now,
      }),
      RELAY_ERROR.UNKNOWN_SPONSOR
    );
  });

  it('releases the reservation and quota slot when submission fails', async () => {
    const { clock, ledger, nonces, user } = setup();
    const submit = jest.fn(async () => {
      throw new Error('network down');
    });
    const packet = signedPacket(user, {}, clock);

    await expect(
      relayMetaTransaction({ packet, ledger, nonces, submit, now: clock.now })
    ).rejects.toThrow('network down');

    expect(ledger.balance('sponsor-a')).toEqual({ depositStroops: 10_000, reservedStroops: 0 });
    // The quota slot came back, so two more relays still fit in the window.
    const retry = jest.fn(async () => ({ hash: 'ok', feeCharged: 0 }));
    await relayMetaTransaction({
      packet: signedPacket(user, { nonce: 'retry' }, clock),
      ledger,
      nonces,
      submit: retry,
      now: clock.now,
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed packets', async () => {
    const { clock, ledger, nonces, submit, user } = setup();
    const packet = signedPacket(user, {}, clock);
    delete packet.innerXdr;
    await expectRelayError(
      relayMetaTransaction({ packet, ledger, nonces, submit, now: clock.now }),
      RELAY_ERROR.MALFORMED
    );
  });

  it('caps the charged fee at the reservation', async () => {
    const { clock, ledger, nonces, user } = setup();
    const submit = jest.fn(async () => ({ hash: 'h', feeCharged: 9_999 }));
    const result = await relayMetaTransaction({
      packet: signedPacket(user, {}, clock),
      ledger,
      nonces,
      submit,
      now: clock.now,
    });
    expect(result.feeCharged).toBe(1_000);
    expect(ledger.balance('sponsor-a').depositStroops).toBe(9_000);
  });
});
