const http = require('http');

/**
 * AdminServer provides an authenticated HTTP API for operational
 * controls such as pausing polling and execution during incidents.
 */
class AdminServer {
  constructor(options = {}) {
    this.port = parseInt(process.env.ADMIN_PORT || '3002', 10);
    this.adminToken = process.env.ADMIN_TOKEN;
    this.logger = options.logger || console;
    this.state = {
      isPollingPaused: false,
      isExecutionPaused: false,
    };
    this.server = null;
  }

  isPollingPaused() { return this.state.isPollingPaused; }
  isExecutionPaused() { return this.state.isExecutionPaused; }

  start() {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.port, () => {
      this.logger.info(`Admin API server listening on port ${this.port}`);
    });
  }

  handleRequest(req, res) {
    // CORS Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      });
      res.end();
      return;
    }

    // Authentication
    const authHeader = req.headers.authorization;
    if (!this.adminToken) {
      this.logger.warn('ADMIN_TOKEN is not set. Admin API is disabled.');
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin API disabled (no token configured)' }));
      return;
    }

    if (authHeader !== `Bearer ${this.adminToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Routing
    if (req.method === 'GET' && req.url === '/admin/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', state: this.state }));
    } else if (req.method === 'POST' && req.url === '/admin/pause') {
      this.handlePause(req, res);
    } else if (req.method === 'POST' && req.url === '/admin/resume') {
      this.handleResume(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  }

  handlePause(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : { target: 'all' };
        if (payload.target === 'polling' || payload.target === 'all') {
          this.state.isPollingPaused = true;
        }
        if (payload.target === 'execution' || payload.target === 'all') {
          this.state.isExecutionPaused = true;
        }
        this.logger.warn('Keeper operations paused via Admin API', { state: this.state, target: payload.target });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'paused', state: this.state }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  handleResume(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : { target: 'all' };
        if (payload.target === 'polling' || payload.target === 'all') {
          this.state.isPollingPaused = false;
        }
        if (payload.target === 'execution' || payload.target === 'all') {
          this.state.isExecutionPaused = false;
        }
        this.logger.info('Keeper operations resumed via Admin API', { state: this.state, target: payload.target });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'resumed', state: this.state }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.logger.info('Admin API server stopped');
    }
  }
}

module.exports = { AdminServer };
