const http = require('node:http');
const registryService = require('./index');

const OPENAPI = {
  openapi: '3.0.3',
  info: { title: 'SoroTask ABI Registry API', version: '1.0.0' },
  paths: {
    '/api/v1/abi/{id}': {
      get: {
        summary: 'Fetch the ABI for a contract',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'ABI found' },
          404: { description: 'ABI not found' },
          429: { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/v1/abi/stream': { get: { summary: 'Stream ABI registry invalidation events using Server-Sent Events' } },
  },
};

function createRegistryServer(options = {}) {
  const service = options.service || registryService;
  const limit = options.rateLimit || 120;
  const windowMs = options.rateWindowMs || 60_000;
  const clients = new Map();
  const subscribers = new Set();
  const server = http.createServer(async (request, response) => {
    const address = request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = clients.get(address);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      clients.set(address, bucket);
    }
    bucket.count += 1;
    response.setHeader('X-RateLimit-Limit', String(limit));
    response.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    if (bucket.count > limit) {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(Math.ceil((bucket.resetAt - now) / 1000)) });
      response.end(JSON.stringify({ error: 'rate_limit_exceeded' }));
      return;
    }

    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/openapi.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(OPENAPI));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/abi/stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      response.write(': connected\n\n');
      subscribers.add(response);
      request.on('close', () => subscribers.delete(response));
      return;
    }
    const match = request.method === 'GET' && url.pathname.match(/^\/api\/v1\/abi\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const wasmHash = url.searchParams.get('wasmHash');
      const abi = wasmHash
        ? await service.getABI(id, wasmHash, async () => service.getRegistry().getABI(id))
        : service.getRegistry().getABI(id);
      if (!abi) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'abi_not_found', id }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' });
      response.end(JSON.stringify({ id, abi }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  const emitUpgrade = (event) => {
    const payload = JSON.stringify({ type: 'ContractUpgraded', event });
    for (const subscriber of subscribers) subscriber.write(`event: ContractUpgraded\ndata: ${payload}\n\n`);
  };
  const emitter = options.eventEmitter || service.indexerEvents;
  if (emitter && typeof emitter.on === 'function') emitter.on('ContractUpgraded', emitUpgrade);

  server.closeRegistryServer = () => {
    if (emitter && typeof emitter.off === 'function') emitter.off('ContractUpgraded', emitUpgrade);
    for (const subscriber of subscribers) subscriber.end();
    subscribers.clear();
  };
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3001;
  const server = createRegistryServer();
  server.listen(port, () => console.log(`[ABI Registry] HTTP gateway listening on ${port}`));
}

module.exports = { createRegistryServer, OPENAPI };
