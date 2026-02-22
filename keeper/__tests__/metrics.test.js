const Metrics = require('../src/metrics');

describe('Metrics', () => {
    beforeEach(() => {
        // Reset metrics before each test
        Metrics.reset();
    });

    describe('increment', () => {
        test('should increment counter by 1 by default', () => {
            Metrics.increment('tasksCheckedTotal');
            expect(Metrics.snapshot().tasksCheckedTotal).toBe(1);
        });

        test('should increment counter by specified amount', () => {
            Metrics.increment('tasksCheckedTotal', 5);
            expect(Metrics.snapshot().tasksCheckedTotal).toBe(5);
        });

        test('should accumulate increments', () => {
            Metrics.increment('tasksExecutedTotal');
            Metrics.increment('tasksExecutedTotal', 3);
            expect(Metrics.snapshot().tasksExecutedTotal).toBe(4);
        });

        test('should throw error for unknown counter', () => {
            expect(() => {
                Metrics.increment('unknownCounter');
            }).toThrow('Unknown counter metric: unknownCounter');
        });
    });

    describe('record', () => {
        test('should record gauge value', () => {
            Metrics.record('lastCycleDurationMs', 1523);
            expect(Metrics.snapshot().lastCycleDurationMs).toBe(1523);
        });

        test('should update gauge value', () => {
            Metrics.record('lastCycleDurationMs', 1000);
            Metrics.record('lastCycleDurationMs', 2000);
            expect(Metrics.snapshot().lastCycleDurationMs).toBe(2000);
        });

        test('should calculate rolling average for fee samples', () => {
            Metrics.record('avgFeePaidXlm', 0.0001);
            Metrics.record('avgFeePaidXlm', 0.0002);
            Metrics.record('avgFeePaidXlm', 0.0003);

            const avg = Metrics.snapshot().avgFeePaidXlm;
            expect(avg).toBeCloseTo(0.0002, 4);
        });

        test('should limit fee samples to maxFeeSamples', () => {
            // Add 105 samples (max is 100)
            for (let i = 1; i <= 105; i++) {
                Metrics.record('avgFeePaidXlm', i);
            }

            // Average should be of last 100 samples (6-105)
            // Sum = (6 + 105) * 100 / 2 = 5550
            // Avg = 5550 / 100 = 55.5
            const avg = Metrics.snapshot().avgFeePaidXlm;
            expect(avg).toBeCloseTo(55.5, 1);
        });

        test('should throw error for unknown gauge', () => {
            expect(() => {
                Metrics.record('unknownGauge', 123);
            }).toThrow('Unknown gauge metric: unknownGauge');
        });
    });

    describe('snapshot', () => {
        test('should return all metrics', () => {
            Metrics.increment('tasksCheckedTotal', 10);
            Metrics.increment('tasksDueTotal', 5);
            Metrics.increment('tasksExecutedTotal', 4);
            Metrics.increment('tasksFailedTotal', 1);
            Metrics.record('lastCycleDurationMs', 1523);
            Metrics.record('avgFeePaidXlm', 0.0001234);

            const snapshot = Metrics.snapshot();

            expect(snapshot).toEqual({
                tasksCheckedTotal: 10,
                tasksDueTotal: 5,
                tasksExecutedTotal: 4,
                tasksFailedTotal: 1,
                avgFeePaidXlm: 0.0001234,
                lastCycleDurationMs: 1523,
            });
        });

        test('should return initial state when no metrics recorded', () => {
            const snapshot = Metrics.snapshot();

            expect(snapshot).toEqual({
                tasksCheckedTotal: 0,
                tasksDueTotal: 0,
                tasksExecutedTotal: 0,
                tasksFailedTotal: 0,
                avgFeePaidXlm: 0,
                lastCycleDurationMs: 0,
            });
        });
    });

    describe('reset', () => {
        test('should reset all counters to 0', () => {
            Metrics.increment('tasksCheckedTotal', 10);
            Metrics.increment('tasksExecutedTotal', 5);

            Metrics.reset();

            const snapshot = Metrics.snapshot();
            expect(snapshot.tasksCheckedTotal).toBe(0);
            expect(snapshot.tasksExecutedTotal).toBe(0);
        });

        test('should reset all gauges to 0', () => {
            Metrics.record('lastCycleDurationMs', 1000);
            Metrics.record('avgFeePaidXlm', 0.5);

            Metrics.reset();

            const snapshot = Metrics.snapshot();
            expect(snapshot.lastCycleDurationMs).toBe(0);
            expect(snapshot.avgFeePaidXlm).toBe(0);
        });

        test('should clear fee samples', () => {
            Metrics.record('avgFeePaidXlm', 1);
            Metrics.record('avgFeePaidXlm', 2);

            Metrics.reset();

            Metrics.record('avgFeePaidXlm', 5);
            expect(Metrics.snapshot().avgFeePaidXlm).toBe(5);
        });
    });
});
