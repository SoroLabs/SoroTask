const http = require('http');
const metrics = require('./metrics');

/**
 * HTTP server for health checks and metrics exposure.
 */
class MetricsServer {
    constructor(options = {}) {
        this.port = options.port || parseInt(process.env.METRICS_PORT || '3001', 10);
        this.healthStaleThreshold = parseInt(
            process.env.HEALTH_STALE_THRESHOLD_MS || '60000',
            10
        );

        this.startTime = Date.now();
        this.lastPollAt = null;
        this.rpcConnected = false;

        this.server = null;
    }

    /**
     * Update health check state.
     * @param {Object} state - Health state object
     * @param {Date} state.lastPollAt - Timestamp of last poll
     * @param {boolean} state.rpcConnected - RPC connection status
     */
    updateHealth(state) {
        if (state.lastPollAt) {
            this.lastPollAt = state.lastPollAt;
        }
        if (typeof state.rpcConnected === 'boolean') {
            this.rpcConnected = state.rpcConnected;
        }
    }

    /**
     * Handle incoming HTTP requests.
     */
    handleRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host}`);

        // Set common headers
        res.setHeader('Content-Type', 'application/json');

        if (url.pathname === '/health') {
            this.handleHealth(req, res);
        } else if (url.pathname === '/metrics') {
            this.handleMetrics(req, res);
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not Found' }));
        }
    }

    /**
     * Handle GET /health endpoint.
     */
    handleHealth(req, res) {
        const now = Date.now();
        const uptimeSeconds = Math.floor((now - this.startTime) / 1000);

        // Check if last poll is stale
        const isStale = this.lastPollAt &&
            (now - this.lastPollAt.getTime()) > this.healthStaleThreshold;

        const status = isStale ? 'stale' : 'ok';
        const httpStatus = isStale ? 503 : 200;

        const response = {
            status,
            uptime: uptimeSeconds,
            lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
            rpcConnected: this.rpcConnected,
        };

        res.writeHead(httpStatus);
        res.end(JSON.stringify(response));
    }

    /**
     * Handle GET /metrics endpoint.
     */
    handleMetrics(req, res) {
        const snapshot = metrics.snapshot();
        res.writeHead(200);
        res.end(JSON.stringify(snapshot, null, 2));
    }

    /**
     * Start the HTTP server.
     * @returns {Promise<void>}
     */
    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.server.on('error', reject);

            this.server.listen(this.port, () => {
                console.log(`[MetricsServer] Listening on port ${this.port}`);
                console.log(`[MetricsServer] Health: http://localhost:${this.port}/health`);
                console.log(`[MetricsServer] Metrics: http://localhost:${this.port}/metrics`);
                resolve();
            });
        });
    }

    /**
     * Stop the HTTP server.
     * @returns {Promise<void>}
     */
    stop() {
        return new Promise((resolve, reject) => {
            if (!this.server || !this.server.listening) {
                resolve();
                return;
            }

            this.server.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('[MetricsServer] Server stopped');
                    resolve();
                }
            });
        });
    }
}

module.exports = MetricsServer;
