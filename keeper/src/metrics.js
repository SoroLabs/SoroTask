const GasMonitor = require('./gasMonitor');

class MetricsServer {
    constructor(gasMonitor) {
        this.gasMonitor = gasMonitor;
        this.server = null;
        this.port = parseInt(process.env.METRICS_PORT) || 3000;
    }

    async start() {
        // Use built-in Node.js modules for a simple metrics endpoint
        const http = require('http');
        
        this.server = http.createServer((req, res) => {
            if (req.url === '/metrics' || req.url === '/metrics/') {
                this.handleMetricsRequest(req, res);
            } else {
                res.writeHead(404, {'Content-Type': 'text/plain'});
                res.end('Not Found');
            }
        });

        this.server.listen(this.port, () => {
            console.log(`Metrics server running on port ${this.port}`);
        });
    }

    handleMetricsRequest(req, res) {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        
        const metrics = [
            '# HELP soro_task_low_gas_count Number of tasks with low gas balance',
            '# TYPE soro_task_low_gas_count gauge',
            `soro_task_low_gas_count ${this.gasMonitor.getLowGasCount()}`,
            
            '# HELP soro_task_gas_warn_threshold Gas balance warning threshold',
            '# TYPE soro_task_gas_warn_threshold gauge',
            `soro_task_gas_warn_threshold ${this.gasMonitor.getConfig().gasWarnThreshold}`,
            
            '# HELP soro_task_alert_debounce_ms Debounce period for alerts in milliseconds',
            '# TYPE soro_task_alert_debounce_ms gauge',
            `soro_task_alert_debounce_ms ${this.gasMonitor.getConfig().alertDebounceMs}`,
            
            '# HELP soro_task_alert_webhook_enabled Whether webhook alerts are enabled',
            '# TYPE soro_task_alert_webhook_enabled gauge',
            `soro_task_alert_webhook_enabled ${this.gasMonitor.getConfig().alertWebhookEnabled ? 1 : 0}`
        ];
        
        res.end(metrics.join('\n') + '\n');
    }

    stop() {
        if (this.server) {
            this.server.close();
        }
    }
}

module.exports = MetricsServer;