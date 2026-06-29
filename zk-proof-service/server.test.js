const http = require('http');
const { createApp } = require('./server');
const { ZKProofService } = require('./index');

function requestJson(server, path) {
  const { port } = server.address();

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET'
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(body)
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

describe('ZK proof Express server', () => {
  test('reports health with readiness and worker status', async () => {
    const service = new ZKProofService(2);
    service.initialize();
    const app = createApp(service);
    const server = app.listen(0);

    try {
      const response = await requestJson(server, '/health');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'zk-proof-service',
        ready: true,
        workers: 2
      });
    } finally {
      service.shutdown();
      server.close();
    }
  });
});
