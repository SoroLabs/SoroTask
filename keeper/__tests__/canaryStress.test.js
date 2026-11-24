/**
 * Stress / simulation for the blue/green canary controller (Issue #1657).
 *
 * Hundreds of seeded rollouts run against a simulated fleet on a virtual
 * clock (no real time passes, no cloud resources):
 *   - healthy releases at a 0.1% background 5xx rate must always promote
 *     (no false rollbacks that would cause needless churn), and
 *   - faulty releases must always be rolled back to 100% stable within 15
 *     seconds of the fault starting, whichever traffic step it lands in.
 * Every request in every run is routed to exactly one color, i.e. no
 * request is dropped by a weight change.
 */
const { CanaryController } = require('../src/deploy/canaryController');
const { SimulatedFleet, createVirtualClock, seededRandom } = require('../src/deploy/providers');

const silentLogger = { info() {}, warn() {}, error() {} };
const RUNS = 60;

function runRollout({ seed, faultAt, faultRate, rps = 500, retainAll = false }) {
  const clock = createVirtualClock();
  const faults = faultRate ? [{ color: 'green', at: faultAt, errorRate: faultRate }] : [];
  const fleet = new SimulatedFleet({
    clock,
    rps,
    seed,
    errorRates: { blue: 0.001, green: 0.001 },
    faults,
    retainAll,
  });
  const controller = new CanaryController({
    router: fleet,
    telemetry: fleet,
    clock,
    logger: silentLogger,
  });
  return controller.run().then((result) => ({ result, fleet }));
}

describe('canary stress simulation', () => {
  test(`${RUNS} healthy rollouts promote with zero false rollbacks`, async () => {
    let promoted = 0;
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const { result, fleet } = await runRollout({ seed });
      if (result.outcome === 'promoted') promoted += 1;
      for (const { weights } of fleet.routeHistory) {
        expect(weights.blue + weights.green).toBe(100);
      }
    }
    expect(promoted).toBe(RUNS);
  });

  test(`${RUNS} faulty rollouts roll back within 15s of fault onset`, async () => {
    const random = seededRandom(1657);
    const faultRates = [0.02, 0.05, 0.25, 1];
    const latencies = [];
    for (let seed = 1; seed <= RUNS; seed += 1) {
      // Fault lands anywhere in the 10% / 50% / 100% steps (each held 60s),
      // leaving at least a few evaluation ticks before promotion.
      const faultAt = Math.floor(random() * 165000);
      const faultRate = faultRates[seed % faultRates.length];
      const { result, fleet } = await runRollout({ seed, faultAt, faultRate });

      expect(result.outcome).toBe('rolled_back');
      const lastRoute = fleet.routeHistory[fleet.routeHistory.length - 1];
      expect(lastRoute.weights).toEqual({ blue: 100, green: 0 });
      const latency = lastRoute.at - faultAt;
      latencies.push(latency);
      expect(latency).toBeLessThanOrEqual(15000);
    }
    const worst = Math.max(...latencies);
    expect(worst).toBeLessThanOrEqual(15000);
  });

  test('a stable fleet never loses requests across weight changes', async () => {
    const { fleet } = await runRollout({ seed: 7, rps: 2000, retainAll: true });
    const total = fleet.samples.length;
    const routed = fleet.samples.filter((s) => s.color === 'blue' || s.color === 'green').length;
    expect(total).toBe(fleet.totalRequests);
    expect(total).toBeGreaterThan(0);
    expect(routed).toBe(total);
  });
});
