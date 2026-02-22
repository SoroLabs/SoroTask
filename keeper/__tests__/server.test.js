const http = require('http');
const MetricsServer = require('../src/server');
const metrics = require('../src/metrics');

describe('MetricsServer', () => {
    let server;

    beforeEach(() => {
        metrics.reset();
    });

    afterEach(async () => {
        if (server) {
            await server.stop();
            server = null;
        }
    });

    describe('Server lifecycle', () => {
        test('should start server on configured port', async () => {
            server = new MetricsServer({ port: 3002 });
            await server.start();

            expect(server.server).toBeDefined();
            expect(server.server.listening).toBe(true);
        });

        test('should stop server gracefully', async () => {
            server = new MetricsServer({ port: 3003 });
            await server.start();

            const listening = server.server.listening;
            expect(listening).toBe(true);

            await server.stop();

            // After stop, server should not be listening
            expect(server.server.listening).toBe(false);
        });

        test('should use default port if not specified', () => {
            server = new MetricsServer();
            expect(server.port).toBe(3001);
        });

        test('should use METRICS_PORT environment variable', () => {
            process.env.METRICS_PORT = '4000';
            server = new MetricsServer();
            expect(server.port).toBe(4000);
            delete process.env.METRICS_PORT;
        });
    });

    describe('GET /health', () => {
        beforeEach(async () => {
            server = new MetricsServer({ port: 3004 });
            await server.start();
            // Small delay to ensure server is ready
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        test('should return 200 OK when healthy', async () => {
            server.updateHealth({
                lastPollAt: new Date(),
                rpcConnected: true,
            });

            const response = await makeRequest(3004, '/health');

            expect(response.statusCode).toBe(200);
            expect(response.body.status).toBe('ok');
            expect(response.body.uptime).toBeGreaterThanOrEqual(0);
            expect(response.body.rpcConnected).toBe(true);
            expect(response.body.lastPollAt).toBeDefined();
        });

        test('should return 503 when last poll is stale', async () => {
            const stalePollTime = new Date(Date.now() - 70000); // 70 seconds ago
            server.updateHealth({
                lastPollAt: stalePollTime,
                rpcConnected: true,
            });

            const response = await makeRequest(3004, '/health');

            expect(response.statusCode).toBe(503);
            expect(response.body.status).toBe('stale');
        });

        test('should return null lastPollAt if never polled', async () => {
            const response = await makeRequest(3004, '/health');

            expect(response.body.lastPollAt).toBeNull();
        });

        test('should track uptime correctly', async () => {
            await new Promise(resolve => setTimeout(resolve, 1100)); // Wait 1.1 seconds

            const response = await makeRequest(3004, '/health');

            expect(response.body.uptime).toBeGreaterThanOrEqual(1);
        });
    });

    describe('GET /metrics', () => {
        beforeEach(async () => {
            server = new MetricsServer({ port: 3005 });
            await server.start();
            // Small delay to ensure server is ready
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        test('should return metrics snapshot', async () => {
            metrics.increment('tasksCheckedTotal', 10);
            metrics.increment('tasksExecutedTotal', 8);
            metrics.increment('tasksFailedTotal', 2);
            metrics.record('lastCycleDurationMs', 1523);

            const response = await makeRequest(3005, '/metrics');

            expect(response.statusCode).toBe(200);
            expect(response.body.tasksCheckedTotal).toBe(10);
            expect(response.body.tasksExecutedTotal).toBe(8);
            expect(response.body.tasksFailedTotal).toBe(2);
            expect(response.body.lastCycleDurationMs).toBe(1523);
        });

        test('should return initial metrics when nothing recorded', async () => {
            const response = await makeRequest(3005, '/metrics');

            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual({
                tasksCheckedTotal: 0,
                tasksDueTotal: 0,
                tasksExecutedTotal: 0,
                tasksFailedTotal: 0,
                avgFeePaidXlm: 0,
                lastCycleDurationMs: 0,
            });
        });
    });

    describe('Error handling', () => {
        beforeEach(async () => {
            server = new MetricsServer({ port: 3006 });
            await server.start();
            // Small delay to ensure server is ready
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        test('should return 404 for unknown routes', async () => {
            const response = await makeRequest(3006, '/unknown');

            expect(response.statusCode).toBe(404);
            expect(response.body.error).toBe('Not Found');
        });
    });

    describe('updateHealth', () => {
        beforeEach(() => {
            server = new MetricsServer({ port: 3007 });
        });

        test('should update lastPollAt', () => {
            const now = new Date();
            server.updateHealth({ lastPollAt: now });

            expect(server.lastPollAt).toEqual(now);
        });

        test('should update rpcConnected', () => {
            server.updateHealth({ rpcConnected: true });
            expect(server.rpcConnected).toBe(true);

            server.updateHealth({ rpcConnected: false });
            expect(server.rpcConnected).toBe(false);
        });

        test('should update partial state', () => {
            server.updateHealth({ rpcConnected: true });
            expect(server.rpcConnected).toBe(true);
            expect(server.lastPollAt).toBeNull();

            const now = new Date();
            server.updateHealth({ lastPollAt: now });
            expect(server.lastPollAt).toEqual(now);
            expect(server.rpcConnected).toBe(true);
        });
    });
});

/**
 * Helper function to make HTTP requests for testing
 */
function makeRequest(port, path) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}${path}`, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        body: JSON.parse(data),
                    });
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}
