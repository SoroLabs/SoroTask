const http = require('http');
const crypto = require('crypto');
const { ApiGateway } = require('../src/apiGateway');
const { MetricsServer } = require('../src/metrics');
const { signGatewayRequest } = require('../src/auth');

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

describe('API gateway HTTP integration', () => {
  test('protects admin APIs and scopes billing data to the authenticated project', async () => {
    const secret = 'gateway-integration-secret-32-bytes';
    const gateway = new ApiGateway({
      projects: {
        'integration-project': {
          tier: 'PRO',
          apiKeys: [{
            keyId: 'integration-key',
            hmacSecret: secret,
            roles: ['read'],
          }, {
            keyId: 'integration-writer',
            hmacSecret: `${secret}-write`,
            roles: ['write'],
          }],
        },
      },
    });
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const metrics = new MetricsServer(null, logger, null, {
      port: 0,
      controlActionHandler: async ({ paused, reason }) => ({ paused, reason }),
    });
    metrics.setApiGateway(gateway);
    metrics.start();

    try {
      await new Promise((resolve, reject) => {
        metrics.server.once('listening', resolve);
        metrics.server.once('error', reject);
      });
      const port = metrics.server.address().port;
      const unauthorized = await request(port, '/admin/billing');
      expect(unauthorized.statusCode).toBe(401);

      const method = 'GET';
      const path = '/admin/billing';
      const timestamp = String(Date.now());
      const nonce = crypto.randomBytes(18).toString('base64url');
      const signature = signGatewayRequest({
        method,
        path,
        timestamp,
        nonce,
        secret,
      });
      const authorized = await request(port, path, {
        headers: {
          'X-API-Key': 'integration-key',
          'X-SoroTask-Timestamp': timestamp,
          'X-SoroTask-Nonce': nonce,
          'X-SoroTask-Signature': signature,
        },
      });

      expect(authorized.statusCode).toBe(200);
      expect(JSON.parse(authorized.body)).toMatchObject({
        projectId: 'integration-project',
        tier: 'PRO',
        totalRequests: 1,
      });

      const writeMethod = 'POST';
      const pausePath = '/admin/keeper/pause';
      const body = Buffer.from('{"reason":"integration"}');
      const writeTimestamp = String(Date.now());
      const writeNonce = crypto.randomBytes(18).toString('base64url');
      const writeSignature = signGatewayRequest({
        method: writeMethod,
        path: pausePath,
        timestamp: writeTimestamp,
        nonce: writeNonce,
        rawBody: body,
        secret: `${secret}-write`,
      });
      const pause = await request(port, pausePath, {
        method: writeMethod,
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'integration-writer',
          'X-SoroTask-Timestamp': writeTimestamp,
          'X-SoroTask-Nonce': writeNonce,
          'X-SoroTask-Signature': writeSignature,
        },
      });

      expect(pause.statusCode).toBe(200);
      expect(JSON.parse(pause.body)).toMatchObject({
        paused: true,
        reason: 'integration',
      });
    } finally {
      await new Promise((resolve) => metrics.server.close(resolve));
    }
  });
});
