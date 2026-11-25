'use strict';

const {
  generateDealerRound,
  combineReceivedShares,
  reconstructCombinedSecret,
} = require('./mpc-dkg');

/** Run a full n-of-n dealer round and return each recipient's combined share. */
function runDkgRound(totalParticipants, threshold) {
  const dealerRounds = [];
  for (let dealer = 1; dealer <= totalParticipants; dealer++) {
    dealerRounds.push(generateDealerRound(threshold, totalParticipants));
  }

  const finalShares = [];
  for (let recipient = 1; recipient <= totalParticipants; recipient++) {
    const received = dealerRounds.map((round, dealerIdx) => {
      const share = round.shares.find((s) => s.to === recipient);
      const commitment = round.commitments.find((c) => c.to === recipient).commitment;
      return { from: dealerIdx + 1, y: share.y, commitment };
    });
    finalShares.push({
      index: recipient,
      share: combineReceivedShares(recipient, received),
    });
  }

  return finalShares;
}

describe('mpc-dkg', () => {
  it('produces consistent combined shares reconstructable from any qualifying subset', () => {
    const totalParticipants = 3;
    const threshold = 2;
    const finalShares = runDkgRound(totalParticipants, threshold);

    // Reconstruct using two different subsets of `threshold` shares — a
    // real (t,n) secret sharing scheme must agree regardless of which
    // subset is used, since all shares lie on the same degree-(t-1)
    // polynomial.
    const secretFrom12 = reconstructCombinedSecret([finalShares[0], finalShares[1]]);
    const secretFrom13 = reconstructCombinedSecret([finalShares[0], finalShares[2]]);
    const secretFrom23 = reconstructCombinedSecret([finalShares[1], finalShares[2]]);

    expect(secretFrom12).toBe(secretFrom13);
    expect(secretFrom13).toBe(secretFrom23);
  });

  it('rejects a share that does not match its commitment (tampering / dishonest dealer)', () => {
    const round = generateDealerRound(2, 3);
    const legitShare = round.shares.find((s) => s.to === 1);
    const legitCommitment = round.commitments.find((c) => c.to === 1).commitment;

    const tamperedY = legitShare.y + 1n;

    expect(() =>
      combineReceivedShares(1, [{ from: 1, y: tamperedY, commitment: legitCommitment }]),
    ).toThrow(/failed its commitment check/);
  });

  it('rejects an out-of-range threshold', () => {
    expect(() => generateDealerRound(0, 3)).toThrow();
    expect(() => generateDealerRound(4, 3)).toThrow();
  });
});
